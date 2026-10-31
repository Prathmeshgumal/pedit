import { vignetteAngle } from '@shared/look'
import { IDENTITY_TRANSFORM, type ClipTransform } from '@shared/model'
import { uvMatrix } from '@shared/transform'
export { coverRect } from './fit'

export type Layer = {
  frame: VideoFrame | ImageBitmap | OffscreenCanvas | HTMLCanvasElement; fit: 'cover' | 'full'; transform?: ClipTransform
  /** 0..1, default 1 */
  alpha?: number
  /** For 'full' layers: screen [0,1]² → texture matrix (column-major mat3), e.g. a text animation's move/scale. */
  uv?: number[]
  /** Colour look baked into a 3D LUT (RGB bytes, size³, red fastest); key identifies it for caching. */
  lut?: { key: string; size: number; data: Uint8Array }
  /** Edge darkening 0..1 (ffmpeg's vignette formula, over the output frame). */
  vignette?: number
}

const FULL = [1, 0, 0, 0, 1, 0, 0, 0, 1]
// q is the quad position in [0,1]² with y down; m maps it to the source texture (crop, rotate, flip, cover)
const VS = `#version 300 es
in vec2 p; uniform mat3 m; out vec2 t; out vec2 q;
void main(){ q = vec2(p.x*.5+.5, .5-p.y*.5); t = (m * vec3(q, 1.)).xy; gl_Position = vec4(p,0.,1.); }`
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 t; in vec2 q; uniform sampler2D s; uniform sampler3D l; uniform float a; uniform float useLut; uniform float lutN; uniform float vig; uniform vec2 size; out vec4 o;
void main(){
  if (t.x < 0. || t.y < 0. || t.x > 1. || t.y > 1.) { o = vec4(0.); return; }
  vec4 c = texture(s, t);
  if (useLut > .5) c.rgb = texture(l, clamp(c.rgb, 0., 1.) * ((lutN - 1.) / lutN) + .5 / lutN).rgb;
  if (vig > 0.) { float d = length((q - .5) * size) / (.5 * length(size)); float k = cos(vig * d); c.rgb *= k * k * k * k; }
  o = c * a;
}`

/** WebGL2 compositor: draws layers bottom-to-top, video with center-crop cover fit. */
export class Compositor {
  private gl: WebGL2RenderingContext
  private m: WebGLUniformLocation
  private a: WebGLUniformLocation
  private u: Record<'useLut' | 'lutN' | 'vig' | 'size' | 's' | 'l', WebGLUniformLocation> = {} as never
  private lutTex: WebGLTexture | null = null
  private lutKey = ''
  private textures: WebGLTexture[] = []

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, desynchronized: true })
    if (!gl) throw new Error('WebGL2 not available')
    this.gl = gl
    const prog = gl.createProgram()!
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src); gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error')
      gl.attachShader(prog, sh)
    }
    gl.linkProgram(prog); gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    this.m = gl.getUniformLocation(prog, 'm')!
    this.a = gl.getUniformLocation(prog, 'a')!
    for (const k of ['useLut', 'lutN', 'vig', 'size', 's', 'l'] as const) this.u[k] = gl.getUniformLocation(prog, k)!
    gl.uniform1i(this.u.s, 0); gl.uniform1i(this.u.l, 1)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    this.gl.viewport(0, 0, w, h)
  }

  private texture(i: number): WebGLTexture {
    const gl = this.gl
    if (!this.textures[i]) {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.textures[i] = t
    }
    return this.textures[i]
  }

  draw(layers: Layer[]): void {
    const gl = this.gl
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
    layers.forEach((l, i) => {
      const src = l.frame
      const w = 'displayWidth' in src ? src.displayWidth : src.width
      const h = 'displayHeight' in src ? src.displayHeight : src.height
      if (!w || !h) return
      gl.bindTexture(gl.TEXTURE_2D, this.texture(i))
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource)
      gl.uniformMatrix3fv(this.m, false, l.fit === 'cover' ? uvMatrix(w, h, l.transform ?? IDENTITY_TRANSFORM, this.canvas.width, this.canvas.height) : l.uv ?? FULL)
      gl.uniform1f(this.a, l.alpha ?? 1)
      gl.uniform1f(this.u.useLut, l.lut ? 1 : 0)
      if (l.lut) { this.bindLut(l.lut); gl.uniform1f(this.u.lutN, l.lut.size) }
      gl.uniform1f(this.u.vig, l.vignette ? vignetteAngle(l.vignette) : 0)
      gl.uniform2f(this.u.size, this.canvas.width, this.canvas.height)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    })
  }

  /** Upload the clip's LUT as a 3D texture on unit 1 (kept until a different look shows). */
  private bindLut(lut: NonNullable<Layer['lut']>): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE1)
    if (!this.lutTex) {
      this.lutTex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v)
    } else gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
    if (this.lutKey !== lut.key) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      this.lutKey = lut.key
    }
    gl.activeTexture(gl.TEXTURE0)
  }

  clear(): void { const gl = this.gl; gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT) }
}

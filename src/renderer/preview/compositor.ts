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

/** Two clips blended during a transition; kind is transitionIndex(type), progress runs 1 → 0 like ffmpeg's xfade. */
export interface TransitionDraw { kind: number; progress: number; a: Layer; b: Layer }

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

// The transition pass: A (outgoing) and B (incoming) are whole frames rendered to textures. Each case is ffmpeg's
// xfade formula, where P goes 1 → 0 and its mix(x, y, m) = x*m + y*(1-m) (fmix here). Kinds follow TRANSITIONS.
const XVS = `#version 300 es
in vec2 p; out vec2 q;
void main(){ q = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0.,1.); }`
const XFS = `#version 300 es
precision highp float;
in vec2 q; uniform sampler2D A; uniform sampler2D B; uniform int kind; uniform float P; uniform vec2 size; out vec4 o;
vec4 ta(vec2 u){ return texture(A, vec2(u.x, 1. - u.y)); }
vec4 tb(vec2 u){ return texture(B, vec2(u.x, 1. - u.y)); }
vec4 fmix(vec4 x, vec4 y, float m){ return x * m + y * (1. - m); }
void main(){
  vec2 u = q; vec4 a = ta(u), b = tb(u);
  if (kind == 0) o = fmix(a, b, P);
  else if (kind == 1 || kind == 2) { vec4 c = kind == 1 ? vec4(0., 0., 0., 1.) : vec4(1.); o = fmix(fmix(a, c, smoothstep(.8, 1., P)), fmix(c, b, smoothstep(.2, 1., P)), P); }
  else if (kind <= 6) { float x = kind == 3 ? u.x : kind == 4 ? 1. - u.x : kind == 5 ? u.y : 1. - u.y; o = fmix(b, a, smoothstep(0., 1., 1. + x - 2. * P)); }
  else if (kind == 7) o = u.x > P ? b : a;
  else if (kind == 8) o = u.x > 1. - P ? a : b;
  else if (kind == 9) o = u.y > P ? b : a;
  else if (kind == 10) o = u.y > 1. - P ? a : b;
  else if (kind == 11) { float s = u.x - P; o = s >= 0. ? tb(vec2(s, u.y)) : ta(vec2(s + 1., u.y)); }
  else if (kind == 12) { float s = u.x + P; o = s < 1. ? tb(vec2(s, u.y)) : ta(vec2(s - 1., u.y)); }
  else if (kind == 13) { float s = u.y - P; o = s >= 0. ? tb(vec2(u.x, s)) : ta(vec2(u.x, s + 1.)); }
  else if (kind == 14) { float s = u.y + P; o = s < 1. ? tb(vec2(u.x, s)) : ta(vec2(u.x, s - 1.)); }
  else if (kind == 15 || kind == 16) {
    float d = length((u - .5) * size) / length(size * .5);
    o = kind == 15 ? fmix(a, b, smoothstep(0., 1., d + (P - .5) * 3.)) : fmix(b, a, smoothstep(0., 1., d + (.5 - P) * 3.));
  }
  else { float zf = smoothstep(.5, 1., P); o = fmix(ta((u - .5) * zf + .5), b, smoothstep(0., .5, P)); }
  o.a = 1.;
}`

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src); gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error')
    gl.attachShader(prog, sh)
  }
  gl.bindAttribLocation(prog, 0, 'p')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
  return prog
}

/** WebGL2 compositor: draws layers bottom-to-top, video with center-crop cover fit. */
export class Compositor {
  private gl: WebGL2RenderingContext
  private m: WebGLUniformLocation
  private a: WebGLUniformLocation
  private u: Record<'useLut' | 'lutN' | 'vig' | 'size' | 's' | 'l', WebGLUniformLocation> = {} as never
  private lutTex: WebGLTexture | null = null
  private lutKey = ''
  private textures: WebGLTexture[] = []
  private prog: WebGLProgram
  private xprog: WebGLProgram
  private xu: Record<'A' | 'B' | 'kind' | 'P' | 'size', WebGLUniformLocation> = {} as never
  private fbos: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }[] = []

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, desynchronized: true })
    if (!gl) throw new Error('WebGL2 not available')
    this.gl = gl
    const prog = program(gl, VS, FS)
    this.prog = prog
    this.xprog = program(gl, XVS, XFS)
    gl.useProgram(this.xprog)
    for (const k of ['A', 'B', 'kind', 'P', 'size'] as const) this.xu[k] = gl.getUniformLocation(this.xprog, k)!
    gl.uniform1i(this.xu.A, 2); gl.uniform1i(this.xu.B, 3)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
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

  /** Draw layers bottom-to-top; with a transition, its two clips are blended first and the layers go on top. */
  draw(layers: Layer[], trans?: TransitionDraw): void {
    const gl = this.gl
    const W = this.canvas.width, H = this.canvas.height
    if (trans) {
      ;[trans.a, trans.b].forEach((l, i) => {
        const f = this.fbo(i, W, H)
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
        gl.viewport(0, 0, W, H)
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
        this.drawLayer(l, i)
      })
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, W, H)
      gl.useProgram(this.xprog)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.fbos[0].tex)
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.fbos[1].tex)
      gl.activeTexture(gl.TEXTURE0)
      gl.uniform1i(this.xu.kind, trans.kind)
      gl.uniform1f(this.xu.P, Math.min(1, Math.max(0, trans.progress)))
      gl.uniform2f(this.xu.size, W, H)
      gl.disable(gl.BLEND)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.enable(gl.BLEND)
      gl.useProgram(this.prog)
    } else {
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
    }
    layers.forEach((l, i) => this.drawLayer(l, i + 2))
  }

  private drawLayer(l: Layer, slot: number): void {
    const gl = this.gl
    const src = l.frame
    const w = 'displayWidth' in src ? src.displayWidth : src.width
    const h = 'displayHeight' in src ? src.displayHeight : src.height
    if (!w || !h) return
    gl.bindTexture(gl.TEXTURE_2D, this.texture(slot))
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource)
    gl.uniformMatrix3fv(this.m, false, l.fit === 'cover' ? uvMatrix(w, h, l.transform ?? IDENTITY_TRANSFORM, this.canvas.width, this.canvas.height) : l.uv ?? FULL)
    gl.uniform1f(this.a, l.alpha ?? 1)
    gl.uniform1f(this.u.useLut, l.lut ? 1 : 0)
    if (l.lut) { this.bindLut(l.lut); gl.uniform1f(this.u.lutN, l.lut.size) }
    gl.uniform1f(this.u.vig, l.vignette ? vignetteAngle(l.vignette) : 0)
    gl.uniform2f(this.u.size, this.canvas.width, this.canvas.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** An offscreen frame the size of the canvas (one per transition side). */
  private fbo(i: number, w: number, h: number): { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } {
    const gl = this.gl
    let f = this.fbos[i]
    if (!f) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
      f = this.fbos[i] = { fb: gl.createFramebuffer()!, tex, w: 0, h: 0 }
    }
    if (f.w !== w || f.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, f.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.tex, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      f.w = w; f.h = h
    }
    return f
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

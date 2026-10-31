import { coverRect } from './fit'
export { coverRect } from './fit'

export type Layer = { frame: VideoFrame | ImageBitmap | OffscreenCanvas | HTMLCanvasElement; fit: 'cover' | 'full' }

const VS = `#version 300 es
in vec2 p; uniform vec4 uv; out vec2 t;
void main(){ t = vec2(uv.x + (p.x*.5+.5)*uv.z, uv.y + (.5-p.y*.5)*uv.w); gl_Position = vec4(p,0.,1.); }`
const FS = `#version 300 es
precision mediump float; in vec2 t; uniform sampler2D s; out vec4 o; void main(){ o = texture(s, t); }`

/** WebGL2 compositor: draws layers bottom-to-top, video with center-crop cover fit. */
export class Compositor {
  private gl: WebGL2RenderingContext
  private uv: WebGLUniformLocation
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
    this.uv = gl.getUniformLocation(prog, 'uv')!
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
      if (l.fit === 'cover') {
        const r = coverRect(w, h, this.canvas.width, this.canvas.height)
        gl.uniform4f(this.uv, r.sx / w, r.sy / h, r.sw / w, r.sh / h)
      } else gl.uniform4f(this.uv, 0, 0, 1, 1)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    })
  }

  clear(): void { const gl = this.gl; gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT) }
}

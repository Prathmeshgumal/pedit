/** Master clock + scheduled playback of decoded AudioBuffers. */
export class AudioOut {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' })
  private nodes = new Set<AudioBufferSourceNode>()
  private ctxStart = 0
  private mediaStartMs = 0
  running = false

  start(mediaMs: number): void {
    void this.ctx.resume()
    this.ctxStart = this.ctx.currentTime + 0.05
    this.mediaStartMs = mediaMs
    this.running = true
  }

  /** Current media time in ms (frozen at start time until the clock passes ctxStart). */
  nowMs(): number {
    if (!this.running) return this.mediaStartMs
    return this.mediaStartMs + Math.max(0, this.contextTime() - this.ctxStart) * 1000
  }

  /** Audio clock interpolated with performance.now(): ctx.currentTime advances in coarse chunks on some systems. */
  private contextTime(): number {
    const ts = this.ctx.getOutputTimestamp()
    if (ts.contextTime === undefined || ts.performanceTime === undefined || ts.performanceTime === 0) return this.ctx.currentTime
    const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000
    // never run ahead of what the hardware could have played by more than one render chunk
    return Math.min(t, this.ctx.currentTime + 0.05)
  }

  /** How far ahead of the clock (ms) a media time is. */
  aheadMs(mediaMs: number): number { return mediaMs - this.nowMs() }

  schedule(buffer: AudioBuffer, mediaMs: number, gain = 1): void {
    if (!this.running) return
    const when = this.ctxStart + (mediaMs - this.mediaStartMs) / 1000
    const node = this.ctx.createBufferSource()
    node.buffer = buffer
    let target: AudioNode = this.ctx.destination
    if (gain !== 1) { const g = this.ctx.createGain(); g.gain.value = gain; g.connect(target); target = g }
    node.connect(target)
    const offset = Math.max(0, this.ctx.currentTime - when)
    if (offset >= buffer.duration) return
    node.start(Math.max(when, this.ctx.currentTime), offset)
    node.onended = () => this.nodes.delete(node)
    this.nodes.add(node)
  }

  stop(): void {
    this.mediaStartMs = this.nowMs()
    this.running = false
    for (const n of this.nodes) { try { n.stop() } catch { /* already stopped */ } }
    this.nodes.clear()
  }

  setTime(ms: number): void { this.mediaStartMs = ms }
}

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

  /** Play `buffer` placed at media time `atMs`, limited to the media window [loMs, hiMs). */
  schedule(buffer: AudioBuffer, atMs: number, gain = 1, loMs = -Infinity, hiMs = Infinity): void {
    if (!this.running) return
    const now = this.nowMs()
    const from = Math.max(atMs, loMs, now)
    const to = Math.min(atMs + buffer.duration * 1000, hiMs)
    if (to - from < 1) return
    const node = this.ctx.createBufferSource()
    node.buffer = buffer
    let target: AudioNode = this.ctx.destination
    if (gain !== 1) { const g = this.ctx.createGain(); g.gain.value = gain; g.connect(target); target = g }
    node.connect(target)
    const when = this.ctxStart + (from - this.mediaStartMs) / 1000
    node.start(Math.max(when, this.ctx.currentTime), (from - atMs) / 1000, (to - from) / 1000)
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

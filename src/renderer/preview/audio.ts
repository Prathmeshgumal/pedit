/** Master clock + scheduled playback of decoded AudioBuffers. */
export class AudioOut {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' })
  private nodes = new Set<AudioBufferSourceNode>()
  private ctxStart = 0
  private mediaStartMs = 0
  running = false
  /** How many sound pieces were scheduled (tests check playback has sound). */
  scheduled = 0

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

  /**
   * Play `buffer` placed at media time `atMs`, limited to the media window [loMs, hiMs).
   * `env` (0..1 at a media time) fades it: the gain ramps linearly across the piece, which is exact for linear fades
   * since pieces are a few tens of ms.
   */
  schedule(buffer: AudioBuffer, atMs: number, gain = 1, loMs = -Infinity, hiMs = Infinity, env?: (ms: number) => number): void {
    if (!this.running) return
    const now = this.nowMs()
    const from = Math.max(atMs, loMs, now)
    const to = Math.min(atMs + buffer.duration * 1000, hiMs)
    if (to - from < 1) return
    const node = this.ctx.createBufferSource()
    node.buffer = buffer
    let target: AudioNode = this.ctx.destination
    const when = this.ctxStart + (from - this.mediaStartMs) / 1000
    const g0 = env ? env(from) : 1, g1 = env ? env(to) : 1
    if (gain !== 1 || g0 !== 1 || g1 !== 1) {
      const g = this.ctx.createGain()
      const at = Math.max(when, this.ctx.currentTime)
      g.gain.setValueAtTime(gain * g0, at)
      if (g1 !== g0) g.gain.linearRampToValueAtTime(gain * g1, at + (to - from) / 1000)
      g.connect(target); target = g
    }
    node.connect(target)
    node.start(Math.max(when, this.ctx.currentTime), (from - atMs) / 1000, (to - from) / 1000)
    node.onended = () => this.nodes.delete(node)
    this.nodes.add(node)
    this.scheduled++
  }

  stop(): void {
    this.mediaStartMs = this.nowMs()
    this.running = false
    for (const n of this.nodes) { try { n.stop() } catch { /* already stopped */ } }
    this.nodes.clear()
  }

  setTime(ms: number): void { this.mediaStartMs = ms }
}

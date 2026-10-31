import type { MediaItem } from '@shared/model'
import { mediaUrl } from '@shared/mediaUrl'
import { ClipSource } from './clipSource'
import { Compositor } from './compositor'
import { AudioOut } from './audio'

const AHEAD_FRAMES = 8
const AUDIO_AHEAD_MS = 1000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Queued = { frame: VideoFrame; ms: number; durMs: number }

/** Plays one clip (Task 5); timeline playback is added with setProject (Task 8). */
export class Player {
  private comp: Compositor
  private audio = new AudioOut()
  private src: ClipSource | null = null
  private gen = 0
  private queue: Queued[] = []
  private shown: VideoFrame | null = null
  private shownMs = -1
  private playing = false
  private raf = 0
  private listeners = new Set<(ms: number) => void>()
  private st = { presented: 0, dropped: 0, lastSeekMs: 0 }
  private t = 0
  durationMs = 0

  constructor(private canvas: HTMLCanvasElement) {
    this.comp = new Compositor(canvas)
  }

  get timeMs(): number { return this.t }
  get isPlaying(): boolean { return this.playing }

  async loadClip(media: MediaItem): Promise<void> {
    this.pause()
    this.gen++
    this.flushQueue()
    this.src?.close()
    this.src = null
    if (!media.proxyPath) throw new Error('no proxy yet')
    const src = await ClipSource.open(mediaUrl(media.proxyPath))
    this.src = src
    this.durationMs = src.durationMs || media.durationMs
    this.st = { presented: 0, dropped: 0, lastSeekMs: 0 }
    await this.seek(0)
  }

  /** Canvas pixel size; draws the current frame again. */
  resize(w: number, h: number): void {
    this.comp.resize(w, h)
    if (this.shown) this.comp.draw([{ frame: this.shown, fit: 'cover' }])
  }

  get sourceSize(): { width: number; height: number } { return { width: this.src?.width ?? 16, height: this.src?.height ?? 9 } }

  play(): void {
    if (this.playing || !this.src) return
    if (this.t >= this.durationMs - 20) this.t = 0
    this.playing = true
    this.audio.start(this.t)
    this.st.presented = 0
    this.st.dropped = 0
    this.startProducers(++this.gen, this.t)
    const tick = (): void => {
      if (!this.playing) return
      this.onFrame()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.audio.stop()
    this.t = Math.min(this.durationMs, this.audio.nowMs())
    this.gen++
    this.flushQueue()
    this.emit()
  }

  toggle(): void { if (this.playing) this.pause(); else this.play() }

  async seek(ms: number): Promise<void> {
    const src = this.src
    if (!src) return
    const wasPlaying = this.playing
    if (wasPlaying) { this.playing = false; cancelAnimationFrame(this.raf); this.audio.stop() }
    const g = ++this.gen
    this.flushQueue()
    this.t = Math.max(0, Math.min(ms, this.durationMs))
    this.emit()
    const t0 = performance.now()
    const r = await src.frameAt(this.t)
    if (g !== this.gen) { r?.frame.close(); return }
    if (r) { this.show(r.frame, r.ms); this.st.lastSeekMs = performance.now() - t0 }
    if (wasPlaying) this.play()
  }

  onTime(cb: (ms: number) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  debug(): Record<string, unknown> {
    return { ctx: this.audio.ctx.state, ctxTime: this.audio.ctx.currentTime, now: this.audio.nowMs(), q: this.queue.length, head: this.queue[0]?.ms, shownMs: this.shownMs, playing: this.playing }
  }

  stats(): { presented: number; dropped: number; lastSeekMs: number } { return { ...this.st } }

  destroy(): void {
    this.pause(); this.gen++; this.flushQueue(); this.src?.close(); this.shown?.close(); this.shown = null
    void this.audio.ctx.close()
  }

  private emit(): void { for (const l of this.listeners) l(this.t) }

  private show(frame: VideoFrame, ms: number): void {
    this.comp.draw([{ frame, fit: 'cover' }])
    this.shown?.close()
    this.shown = frame
    this.shownMs = ms
  }

  private flushQueue(): void { for (const q of this.queue) q.frame.close(); this.queue = [] }

  private onFrame(): void {
    const now = this.audio.nowMs()
    this.t = Math.min(now, this.durationMs)
    let pick: Queued | null = null
    while (this.queue.length && this.queue[0].ms <= now) {
      if (pick) { pick.frame.close(); this.st.dropped++ }
      pick = this.queue.shift()!
    }
    if (pick) { this.show(pick.frame, pick.ms); this.st.presented++ }
    else if (this.shown && now > this.shownMs + 50 && this.queue.length === 0 && now < this.durationMs - 50) this.st.dropped++
    this.emit()
    if (now >= this.durationMs) this.pause()
  }

  private startProducers(g: number, fromMs: number): void {
    const src = this.src!
    void (async () => {
      for await (const q of src.frames(fromMs)) {
        if (g !== this.gen) { q.frame.close(); return }
        if (q.ms + q.durMs < fromMs) { q.frame.close(); continue }
        this.queue.push(q)
        while (this.queue.length >= AHEAD_FRAMES && g === this.gen) await sleep(4)
      }
    })()
    void (async () => {
      for await (const a of src.audio(fromMs)) {
        if (g !== this.gen) return
        while (this.audio.aheadMs(a.startMs) > AUDIO_AHEAD_MS && g === this.gen) await sleep(50)
        if (g !== this.gen) return
        this.audio.schedule(a.buffer, a.startMs)
      }
    })()
  }
}

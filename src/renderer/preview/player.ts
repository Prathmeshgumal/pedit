import { STILL_DEFAULT_MS, timelineDurationMs, type ClipTransform, type MediaItem, type Project, type TextItem } from '@shared/model'
import { mediaUrl } from '@shared/mediaUrl'
import { openSource, type MediaSource } from './clipSource'
import { Compositor, type Layer } from './compositor'
import { AudioOut } from './audio'

const AHEAD_FRAMES = 12
const AUDIO_AHEAD_MS = 1000
/** Frames decoded ahead before the clock (re)starts. */
const BUFFER_FRAMES = 4
const MAX_SOURCES = 6
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A span of the output timeline backed by a range of one source file. */
interface Seg { startMs: number; inMs: number; outMs: number; url: string | null; gain: number; still?: boolean; transform?: ClipTransform }
type Queued = { frame: VideoFrame; ms: number; durMs: number }
export type TextLayerFn = (texts: TextItem[], width: number, height: number, ms?: number) => Layer[]

const end = (s: Seg): number => s.startMs + s.outMs - s.inMs
const proxyUrl = (m: MediaItem | undefined): string | null => (m?.proxyPath && m.status !== 'offline' ? mediaUrl(m.proxyPath) : null)
const audioUrl = (m: MediaItem | undefined): string | null => {
  if (!m || !m.hasAudio || m.status === 'offline') return null
  if (m.kind === 'audio') return mediaUrl(m.path)
  return m.proxyPath ? mediaUrl(m.proxyPath) : null
}

/** Plays either a single clip or the whole project timeline, from proxies. */
export class Player {
  private comp: Compositor
  private audio = new AudioOut()
  private sources = new Map<string, Promise<MediaSource>>()
  private gen = 0
  private queue: Queued[] = []
  private shown: VideoFrame | null = null
  private shownMs = -1
  private playing = false
  /** Playback should resume once the seek in flight finishes (a newer seek inherits this). */
  private resumeAfterSeek = false
  /** What the timeline plays (segments, lanes, length, size); unchanged → no re-seek on a project update. */
  private playKey = ''
  /** Tests only: extra wait per decoded frame, to simulate a busy decoder. */
  decodeDelayMs = 0
  /** Waiting for video frames: the clock is held still (at start, and whenever decoding falls behind). */
  private buffering = false
  private bufferSince = 0
  /** Audio producers' generation: bumped whenever the clock restarts after buffering. */
  private agen = 0
  private raf = 0
  private listeners = new Set<(ms: number) => void>()
  private st = { presented: 0, dropped: 0, lastSeekMs: 0, seeks: 0, stalls: 0 }
  private t = 0
  private video: Seg[] = []
  private lanes: Seg[][] = []
  private project: Project | null = null
  private size = { width: 16, height: 9 }
  private textLayers: TextLayerFn | null = null
  durationMs = 0
  mode: 'clip' | 'timeline' = 'timeline'

  constructor(private canvas: HTMLCanvasElement) {
    this.comp = new Compositor(canvas)
  }

  get timeMs(): number { return this.t }
  get isPlaying(): boolean { return this.playing }
  get sourceSize(): { width: number; height: number } { return this.size }

  // test helpers
  getDuration(): number { return this.durationMs }
  getTime(): number { return this.t }
  isPlayingNow(): boolean { return this.playing }

  setTextRenderer(fn: TextLayerFn): void { this.textLayers = fn }

  /** Preview one media file on its own. */
  async loadClip(media: MediaItem): Promise<void> {
    this.mode = 'clip'
    this.playKey = ''
    this.project = null
    const url = proxyUrl(media)
    if (!url) throw new Error('no proxy yet')
    const src = await this.source(url)
    const still = media.kind === 'image'
    const dur = still ? STILL_DEFAULT_MS : src.durationMs || media.durationMs
    this.size = { width: src.width || media.width || 16, height: src.height || media.height || 9 }
    this.video = [{ startMs: 0, inMs: 0, outMs: dur, url, gain: 1, still }]
    this.lanes = src.hasAudio ? [[{ startMs: 0, inMs: 0, outMs: dur, url, gain: 1 }]] : []
    this.durationMs = dur
    this.st = { presented: 0, dropped: 0, lastSeekMs: 0, seeks: 0, stalls: 0 }
    await this.seek(0)
  }

  /** Preview the timeline; call on every project change. Keeps the playhead. */
  async setProject(p: Project): Promise<void> {
    const wasPlaying = (this.playing || this.resumeAfterSeek) && this.mode === 'timeline'
    const media = new Map(p.media.map((m) => [m.id, m]))
    const video = p.video.map((v) => ({ startMs: v.startMs, inMs: v.inMs, outMs: v.outMs, url: proxyUrl(media.get(v.mediaId)), gain: v.volume, still: media.get(v.mediaId)?.kind === 'image', transform: v.transform }))
    const clipAudio = p.video.map((v) => ({ startMs: v.startMs, inMs: v.inMs, outMs: v.outMs, url: audioUrl(media.get(v.mediaId)), gain: v.volume }))
    // one producer per audio lane: items on a lane never overlap, so each lane plays in order
    const byLane = new Map<number, Seg[]>()
    for (const a of [...p.audio].sort((x, y) => x.startMs - y.startMs)) {
      const seg = { startMs: a.startMs, inMs: a.inMs, outMs: a.outMs, url: audioUrl(media.get(a.mediaId)), gain: a.volume }
      if (seg.url) byLane.set(a.lane ?? 0, [...(byLane.get(a.lane ?? 0) ?? []), seg])
    }
    const lanes = [clipAudio.filter((s) => s.url), ...byLane.values()]
    const durationMs = timelineDurationMs(p)
    const key = JSON.stringify([video, lanes, durationMs, p.settings.width, p.settings.height])
    const same = this.mode === 'timeline' && key === this.playKey
    this.project = p // text and other per-frame drawing read this
    if (same) { if (!this.playing) this.redraw(); return }
    this.mode = 'timeline'
    this.playKey = key
    this.size = { width: p.settings.width, height: p.settings.height }
    this.video = video
    this.lanes = lanes
    this.durationMs = durationMs
    await this.seek(Math.min(this.t, this.durationMs), wasPlaying)
  }

  resize(w: number, h: number): void {
    this.comp.resize(w, h)
    this.redraw()
  }

  play(): void {
    if (this.playing || this.durationMs <= 0) return
    if (this.t >= this.durationMs - 20) this.t = 0
    this.playing = true
    this.st.presented = 0
    this.st.dropped = 0
    const g = ++this.gen
    this.produceVideo(g, this.t)
    // pre-roll: hold the clock until the first frames are decoded (onFrame starts it)
    if (this.needsFrames(this.t)) { this.buffering = true; this.bufferSince = performance.now() } else this.startClock()
    const tick = (): void => {
      if (!this.playing) return
      this.onFrame()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  pause(): void {
    this.resumeAfterSeek = false
    if (!this.playing) return
    this.playing = false
    this.buffering = false
    this.agen++
    cancelAnimationFrame(this.raf)
    this.audio.stop()
    this.t = Math.min(this.durationMs, this.audio.nowMs())
    this.gen++
    this.flushQueue()
    this.emit()
  }

  toggle(): void { if (this.playing || this.resumeAfterSeek) this.pause(); else this.play() }

  async seek(ms: number, resume = this.playing || this.resumeAfterSeek): Promise<void> {
    this.resumeAfterSeek = resume
    if (this.playing) { this.playing = false; this.buffering = false; this.agen++; cancelAnimationFrame(this.raf); this.audio.stop() }
    this.st.seeks++
    const g = ++this.gen
    this.flushQueue()
    this.t = Math.max(0, Math.min(ms, this.durationMs))
    this.emit()
    const t0 = performance.now()
    const seg = this.segAt(this.t)
    if (!seg?.url) {
      this.show(null, this.t)
    } else {
      const src = await this.source(seg.url)
      const r = await src.frameAt(seg.inMs + (this.t - seg.startMs))
      if (g !== this.gen) { r?.frame.close(); return }
      this.show(r?.frame ?? null, this.t)
    }
    this.st.lastSeekMs = performance.now() - t0
    // read the flag, not `resume`: a pause() during the seek cancels it
    const go = this.resumeAfterSeek
    this.resumeAfterSeek = false
    if (go) this.play()
  }

  onTime(cb: (ms: number) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  stats(): { presented: number; dropped: number; lastSeekMs: number; seeks: number; stalls: number; audioScheduled: number } { return { ...this.st, audioScheduled: this.audio.scheduled } }
  debug(): Record<string, unknown> {
    return { ctx: this.audio.ctx.state, now: this.audio.nowMs(), q: this.queue.length, head: this.queue[0]?.ms, shownMs: this.shownMs, playing: this.playing, mode: this.mode }
  }

  destroy(): void {
    this.pause(); this.gen++; this.flushQueue()
    for (const p of this.sources.values()) void p.then((s) => s.close(), () => {})
    this.sources.clear()
    this.shown?.close(); this.shown = null
    void this.audio.ctx.close()
  }

  private emit(): void { for (const l of this.listeners) l(this.t) }

  private segAt(ms: number): Seg | null {
    for (const s of this.video) if (ms >= s.startMs && ms < end(s)) return s
    return null
  }

  private source(url: string): Promise<MediaSource> {
    let p = this.sources.get(url)
    if (p) { this.sources.delete(url); this.sources.set(url, p); return p } // LRU touch
    p = openSource(url)
    p.catch(() => this.sources.delete(url))
    this.sources.set(url, p)
    if (this.sources.size > MAX_SOURCES) {
      const keep = new Set([...this.video, ...this.lanes.flat()].filter((s) => Math.abs(s.startMs - this.t) < 30000).map((s) => s.url))
      for (const [u, sp] of this.sources) {
        if (this.sources.size <= MAX_SOURCES) break
        if (u === url || keep.has(u)) continue
        this.sources.delete(u)
        void sp.then((s) => s.close(), () => {})
      }
    }
    return p
  }

  private layers(frame: VideoFrame | null, ms = this.shownMs >= 0 ? this.shownMs : this.t): Layer[] {
    const transform = this.mode === 'timeline' ? this.segAt(ms)?.transform : undefined
    const out: Layer[] = frame ? [{ frame, fit: 'cover', transform }] : []
    if (this.mode === 'timeline' && this.project && this.textLayers) {
      const texts = this.project.text.filter((x) => this.t >= x.startMs && this.t < x.startMs + x.durationMs)
      if (texts.length) out.push(...this.textLayers(texts, this.canvas.width, this.canvas.height, this.t))
    }
    return out
  }

  private show(frame: VideoFrame | null, ms: number): void {
    this.comp.draw(this.layers(frame, ms))
    if (frame !== this.shown) this.shown?.close()
    this.shown = frame
    this.shownMs = ms
  }

  private redraw(): void { this.comp.draw(this.layers(this.shown)) }
  /** Repaint the current frame (e.g. a text layer finished rendering). */
  requestRedraw(): void { if (!this.playing) this.redraw() }

  private flushQueue(): void { for (const q of this.queue) q.frame.close(); this.queue = [] }

  /** Is there decoded video to wait for at `ms` (not a gap, photo or audio-only stretch)? */
  private needsFrames(ms: number): boolean {
    const seg = this.segAt(ms)
    return !!seg?.url && !seg.still
  }

  /** Start (or restart) the clock at this.t and the audio producers with it. */
  private startClock(): void {
    this.buffering = false
    this.audio.start(this.t)
    const ag = ++this.agen
    for (const lane of this.lanes) this.produceAudio(ag, lane, this.t)
  }

  private onFrame(): void {
    if (this.buffering) {
      // enough frames to play on (or the producer gave nothing for a while: don't hang)
      const ready = this.queue.length >= BUFFER_FRAMES || (this.queue.length > 0 && performance.now() - this.bufferSince > 400) || performance.now() - this.bufferSince > 2000
      if (!ready) return
      // the clock resumes at the first waiting frame, so it is shown, not dropped
      if (this.queue.length && this.queue[0].ms < this.t) this.t = this.queue[0].ms
      this.startClock()
    }
    const now = this.audio.nowMs()
    this.t = Math.min(now, this.durationMs)
    let pick: Queued | null = null
    while (this.queue.length && this.queue[0].ms <= now) {
      if (pick) { pick.frame.close(); this.st.dropped++ }
      pick = this.queue.shift()!
    }
    const seg = this.segAt(this.t)
    if (pick) { this.show(pick.frame, pick.ms); this.st.presented++ }
    else if (!seg?.url) { if (this.shown) this.show(null, this.t); else this.redraw() }
    else if (!seg.still && this.queue.length === 0 && now > this.shownMs + 120 && this.shownMs >= seg.startMs - 1) {
      // decoding fell behind: hold the clock where the picture is, instead of letting sound run ahead
      this.audio.stop()
      this.agen++
      this.t = Math.max(seg.startMs, this.shownMs + 1)
      this.buffering = true
      this.bufferSince = performance.now()
      this.st.stalls++
    }
    else if (this.project?.text.length) this.redraw()
    this.emit()
    if (now >= this.durationMs) { this.pause(); this.t = this.durationMs; this.emit() }
  }

  private produceVideo(g: number, fromMs: number): void {
    void (async () => {
      const first = this.video.findIndex((s) => fromMs < end(s))
      if (first < 0) return
      for (let i = first; i < this.video.length; i++) {
        const seg = this.video[i]
        if (!seg.url) continue
        const next = this.video[i + 1]
        const src = await this.source(seg.url)
        if (next?.url) void this.source(next.url) // pre-open the next clip
        const startSrc = seg.inMs + Math.max(0, fromMs - seg.startMs)
        for await (const f of src.frames(startSrc)) {
          if (g !== this.gen) { f.frame.close(); return }
          if (f.ms >= seg.outMs) { f.frame.close(); break }
          const tl = seg.startMs + (f.ms - seg.inMs)
          if (tl + f.durMs <= fromMs) { f.frame.close(); continue }
          if (this.decodeDelayMs) await sleep(this.decodeDelayMs)
          this.queue.push({ frame: f.frame, ms: Math.max(tl, seg.startMs), durMs: f.durMs })
          while (this.queue.length >= AHEAD_FRAMES && g === this.gen) await sleep(4)
        }
        if (g !== this.gen) return
      }
    })().catch((e) => console.error('video producer', e))
  }

  private produceAudio(g: number, lane: Seg[], fromMs: number): void {
    // g is the audio generation (agen)
    void (async () => {
      for (const seg of lane) {
        if (end(seg) <= fromMs || !seg.url) continue
        const src = await this.source(seg.url)
        const startSrc = seg.inMs + Math.max(0, fromMs - seg.startMs)
        for await (const a of src.audio(Math.max(0, startSrc - 50))) {
          if (g !== this.agen) return
          if (a.startMs >= seg.outMs) break
          const tl = seg.startMs + (a.startMs - seg.inMs)
          while (this.audio.aheadMs(tl) > AUDIO_AHEAD_MS && g === this.agen) await sleep(50)
          if (g !== this.agen) return
          this.audio.schedule(a.buffer, tl, seg.gain, Math.max(seg.startMs, fromMs), end(seg))
        }
        if (g !== this.agen) return
      }
    })().catch((e) => console.error('audio producer', e))
  }
}

import { ALL_FORMATS, AudioBufferSink, Input, UrlSource, VideoSampleSink } from 'mediabunny'

/** Decodes one proxy file. All times in milliseconds of source time. */
export class ClipSource {
  private constructor(
    private input: Input,
    private video: VideoSampleSink | null,
    private audioSink: AudioBufferSink | null,
    readonly durationMs: number,
    readonly width: number,
    readonly height: number
  ) {}

  static async open(url: string): Promise<ClipSource> {
    const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) })
    const vt = await input.getPrimaryVideoTrack()
    const at = await input.getPrimaryAudioTrack()
    const dur = await input.computeDuration()
    return new ClipSource(
      input,
      vt ? new VideoSampleSink(vt) : null,
      at ? new AudioBufferSink(at) : null,
      Math.round(dur * 1000),
      vt?.displayWidth ?? 0,
      vt?.displayHeight ?? 0
    )
  }

  get hasAudio(): boolean { return !!this.audioSink }

  /** Frame shown at sourceMs (nearest keyframe, then decode forward). Caller closes it. */
  async frameAt(sourceMs: number): Promise<{ frame: VideoFrame; ms: number } | null> {
    if (!this.video) return null
    const s = await this.video.getSample(Math.max(0, sourceMs) / 1000)
    if (!s) return null
    const frame = s.toVideoFrame()
    const ms = s.microsecondTimestamp / 1000
    s.close()
    return { frame, ms }
  }

  /** Sequential frames from sourceMs. Caller closes each frame. */
  async *frames(fromMs: number): AsyncGenerator<{ frame: VideoFrame; ms: number; durMs: number }> {
    if (!this.video) return
    for await (const s of this.video.samples(Math.max(0, fromMs) / 1000)) {
      const out = { frame: s.toVideoFrame(), ms: s.microsecondTimestamp / 1000, durMs: s.microsecondDuration / 1000 }
      s.close()
      yield out
    }
  }

  async *audio(fromMs: number): AsyncGenerator<{ buffer: AudioBuffer; startMs: number }> {
    if (!this.audioSink) return
    for await (const b of this.audioSink.buffers(Math.max(0, fromMs) / 1000)) yield { buffer: b.buffer, startMs: b.timestamp * 1000 }
  }

  close(): void { this.input.dispose() }
}

/** A photo's preview jpg, shown as the same frame for as long as its clip lasts. */
export class StillSource {
  readonly durationMs = 0
  readonly hasAudio = false
  private constructor(private bmp: ImageBitmap) {}

  static async open(url: string): Promise<StillSource> {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`could not load ${url}`)
    return new StillSource(await createImageBitmap(await r.blob()))
  }

  get width(): number { return this.bmp.width }
  get height(): number { return this.bmp.height }

  private frame(ms: number): VideoFrame { return new VideoFrame(this.bmp, { timestamp: Math.round(ms * 1000) }) }

  async frameAt(sourceMs: number): Promise<{ frame: VideoFrame; ms: number }> { return { frame: this.frame(sourceMs), ms: sourceMs } }

  /** One frame that stays on screen until the clip ends. */
  async *frames(fromMs: number): AsyncGenerator<{ frame: VideoFrame; ms: number; durMs: number }> {
    yield { frame: this.frame(fromMs), ms: fromMs, durMs: 0 }
  }

  async *audio(_fromMs: number): AsyncGenerator<{ buffer: AudioBuffer; startMs: number }> {}

  close(): void { this.bmp.close() }
}

export type MediaSource = ClipSource | StillSource
export const openSource = (url: string): Promise<MediaSource> => (/\.(jpe?g|png|webp)$/i.test(url) ? StillSource.open(url) : ClipSource.open(url))

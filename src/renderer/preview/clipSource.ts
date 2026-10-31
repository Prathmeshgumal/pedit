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

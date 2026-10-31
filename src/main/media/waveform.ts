import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { ffmpegPath } from './ffmpeg'

export const PEAKS_PER_SECOND = 100
const SAMPLE_RATE = 8000

/** Writes mono absolute peaks (Float32 LE, 100 per second) for the file's first audio stream. */
export function buildWaveform(input: string, out: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input, '-map', '0:a:0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'])
    const per = SAMPLE_RATE / PEAKS_PER_SECOND
    const peaks: number[] = []
    let cur = 0
    let n = 0
    let rest = Buffer.alloc(0)
    let err = ''
    const onAbort = (): void => { child.kill('SIGKILL') }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (c: Buffer) => {
      const buf = rest.length ? Buffer.concat([rest, c]) : c
      const whole = buf.length - (buf.length % 4)
      for (let i = 0; i < whole; i += 4) {
        const v = Math.abs(buf.readFloatLE(i))
        if (v > cur) cur = v
        if (++n === per) { peaks.push(cur); cur = 0; n = 0 }
      }
      rest = buf.subarray(whole)
    })
    child.stderr.on('data', (c: Buffer) => { err += c.toString() })
    child.on('error', reject)
    child.on('close', async (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(new Error('aborted'))
      if (code !== 0) return reject(new Error(`waveform failed: ${err.trim()}`))
      if (n > 0) peaks.push(cur)
      const arr = Float32Array.from(peaks)
      try { await writeFile(out, Buffer.from(arr.buffer)); resolve() } catch (e) { reject(e) }
    })
  })
}

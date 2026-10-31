import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const exe = process.platform === 'win32' ? '.exe' : ''
const platformDir = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`

let cachedDir: string | null = null
function binDir(): string {
  if (cachedDir) return cachedDir
  const candidates: string[] = []
  if (process.env.PEDIT_RESOURCES) candidates.push(process.env.PEDIT_RESOURCES)
  const rp = (process as { resourcesPath?: string }).resourcesPath
  if (rp) candidates.push(rp)
  let d = import.meta.dirname
  for (let i = 0; i < 6; i++) { candidates.push(join(d, 'resources')); d = dirname(d) }
  for (const c of candidates) {
    const dir = join(c, 'ffmpeg', platformDir)
    if (existsSync(join(dir, `ffmpeg${exe}`))) return (cachedDir = resolve(dir))
  }
  throw new Error(`bundled ffmpeg not found (looked for ffmpeg/${platformDir} in ${candidates.join(', ')})`)
}

export const ffmpegPath = (): string => join(binDir(), `ffmpeg${exe}`)
export const ffprobePath = (): string => join(binDir(), `ffprobe${exe}`)
/** Bundled Inter font, for text ffmpeg burns into frames (contact sheets). */
export const fontPath = (): string => resolve(binDir(), '../../fonts/Inter-Bold.ttf')

export function runFfmpeg(
  args: string[],
  opts: { onProgress?: (outTimeMs: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  return new Promise((resolveP, reject) => {
    if (opts.signal?.aborted) return reject(new Error('aborted'))
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    let aborted = false
    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line.startsWith('out_time_us=')) {
          const us = Number(line.slice(12))
          if (Number.isFinite(us) && us >= 0) opts.onProgress?.(Math.floor(us / 1000))
        }
      }
    })
    child.stderr.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000) })
    const onAbort = (): void => { aborted = true; child.kill('SIGKILL') }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', reject)
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (aborted) reject(new Error('aborted'))
      else if (code === 0) resolveP()
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`))
    })
  })
}

export interface EncoderInfo { h264: string; hevc: string | null; hwaccel: string[]; vaapiDevice?: string }

const VAAPI_DEVICE = '/dev/dri/renderD128'
let encCache: Promise<EncoderInfo> | null = null

async function tryRun(args: string[]): Promise<boolean> {
  try {
    await execFileP(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { timeout: 20000 })
    return true
  } catch {
    return false
  }
}

function encodeTestArgs(encoder: string): string[] {
  const src = ['-f', 'lavfi', '-i', 'color=c=gray:s=256x256:r=30:d=0.2']
  if (encoder.endsWith('_vaapi')) return ['-vaapi_device', VAAPI_DEVICE, ...src, '-vf', 'format=nv12,hwupload', '-c:v', encoder, '-f', 'null', '-']
  return [...src, '-pix_fmt', 'nv12', '-c:v', encoder, '-f', 'null', '-']
}

async function pick(listed: string, order: string[]): Promise<string | null> {
  for (const e of order) {
    if (!new RegExp(`\\s${e}\\s`).test(listed)) continue
    if (e.startsWith('lib') || (await tryRun(encodeTestArgs(e)))) return e
  }
  return null
}

export function detectEncoders(): Promise<EncoderInfo> {
  encCache ??= (async () => {
    const { stdout: listed } = await execFileP(ffmpegPath(), ['-hide_banner', '-encoders'])
    const h264 = await pick(listed, ['h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_videotoolbox', 'libx264'])
    const hevc = await pick(listed, ['hevc_nvenc', 'hevc_qsv', 'hevc_vaapi', 'hevc_videotoolbox', 'libx265'])
    const { stdout: hw } = await execFileP(ffmpegPath(), ['-hide_banner', '-hwaccels'])
    const hwaccel: string[] = []
    for (const t of ['cuda', 'vaapi', 'qsv', 'videotoolbox']) {
      if (!hw.split('\n').some((l) => l.trim() === t)) continue
      const dev = t === 'vaapi' ? `vaapi=x:${VAAPI_DEVICE}` : `${t}=x`
      if (await tryRun(['-init_hw_device', dev, '-f', 'lavfi', '-i', 'nullsrc=d=0.1', '-frames:v', '1', '-f', 'null', '-'])) hwaccel.push(t)
    }
    if (!h264) throw new Error('no H.264 encoder available in bundled ffmpeg')
    return { h264, hevc, hwaccel, ...(hwaccel.includes('vaapi') || h264.endsWith('_vaapi') ? { vaapiDevice: VAAPI_DEVICE } : {}) }
  })()
  return encCache
}

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import type { ColorTransfer, MediaItem } from '../../shared/model'
import { ffprobePath } from './ffmpeg'

const execFileP = promisify(execFile)

interface FFStream {
  codec_type: string; codec_name?: string; width?: number; height?: number
  avg_frame_rate?: string; r_frame_rate?: string; pix_fmt?: string; bits_per_raw_sample?: string
  color_transfer?: string; duration?: string; tags?: Record<string, string>
  side_data_list?: Array<{ rotation?: number }>; disposition?: { attached_pic?: number }
}
interface FFProbe { streams: FFStream[]; format: { duration?: string; tags?: Record<string, string> } }

export type ProbeResult = Omit<MediaItem, 'id' | 'importIndex' | 'status' | 'folder'>

const IMAGE_CODECS = new Set(['mjpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'])

function rate(s?: string): number {
  if (!s) return 0
  const [n, d] = s.split('/').map(Number)
  const v = d ? n / d : n
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

function transfer(t?: string): ColorTransfer {
  if (t === 'arib-std-b67') return 'hlg'
  if (t === 'smpte2084') return 'pq'
  return 'sdr'
}

function bitDepth(v: FFStream): number {
  const raw = Number(v.bits_per_raw_sample)
  if (raw) return raw
  const m = /p(\d{2})(le|be)?$/.exec(v.pix_fmt ?? '')
  return m ? Number(m[1]) : 8
}

function createdAt(p: FFProbe, v: FFStream | undefined, mtime: Date): string {
  const tags = { ...(v?.tags ?? {}), ...(p.format.tags ?? {}) }
  const raw = tags.creation_time ?? tags['com.apple.quicktime.creationdate']
  const d = raw ? new Date(raw) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : mtime.toISOString()
}

export async function probe(path: string): Promise<ProbeResult> {
  let st
  try {
    st = await stat(path)
  } catch {
    throw new Error(`cannot read media file: ${path}`)
  }
  let out: string
  try {
    ;({ stdout: out } = await execFileP(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { maxBuffer: 16 * 1024 * 1024 }))
  } catch (e) {
    throw new Error(`not a readable media file: ${basename(path)} (${(e as Error).message.split('\n')[0]})`)
  }
  const p = JSON.parse(out) as FFProbe
  const v = p.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const a = p.streams.find((s) => s.codec_type === 'audio')
  if (!v && !a) throw new Error(`no audio or video stream: ${basename(path)}`)
  const kind: MediaItem['kind'] = v ? (IMAGE_CODECS.has(v.codec_name ?? '') && !p.format.duration ? 'image' : 'video') : 'audio'
  const rotRaw = v?.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation ?? 0
  const rotation = ((((Math.round(rotRaw / 90) * 90) % 360) + 360) % 360) as MediaItem['rotation']
  let width = v?.width ?? 0
  let height = v?.height ?? 0
  if (rotation === 90 || rotation === 270) [width, height] = [height, width]
  const dur = Number(p.format.duration ?? v?.duration ?? a?.duration ?? 0)
  return {
    path,
    name: basename(path),
    kind,
    createdAt: createdAt(p, v, st.mtime),
    durationMs: Math.round(dur * 1000),
    width, height,
    fps: v ? rate(v.avg_frame_rate) || rate(v.r_frame_rate) : 0,
    codec: (v ?? a)!.codec_name ?? 'unknown',
    bitDepth: v ? bitDepth(v) : 0,
    colorTransfer: transfer(v?.color_transfer),
    hasAudio: !!a,
    rotation
  }
}

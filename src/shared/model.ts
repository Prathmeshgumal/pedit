export type MediaId = string
export type ItemId = string
export type Aspect = '16:9' | '9:16' | '1:1'
export type ColorTransfer = 'sdr' | 'hlg' | 'pq'

export interface MediaItem {
  id: MediaId
  path: string
  name: string
  folder: string
  kind: 'video' | 'audio' | 'image'
  createdAt: string
  importIndex: number
  durationMs: number
  width: number
  height: number
  fps: number
  codec: string
  bitDepth: number
  colorTransfer: ColorTransfer
  hasAudio: boolean
  rotation: 0 | 90 | 180 | 270
  proxyPath?: string
  thumbPath?: string
  filmstripPath?: string
  waveformPath?: string
  status: 'probing' | 'processing' | 'ready' | 'offline' | 'error'
  error?: string
}

export interface VideoItem { id: ItemId; mediaId: MediaId; startMs: number; inMs: number; outMs: number; volume: number }

export interface TextStyle {
  font: 'Inter'
  bold: boolean
  sizePct: number
  color: string
  position: 'top' | 'center' | 'bottom'
  background: string | null
}

export interface TextItem { id: ItemId; startMs: number; durationMs: number; text: string; style: TextStyle }
export interface AudioItem { id: ItemId; mediaId: MediaId; startMs: number; inMs: number; outMs: number; volume: number }

export interface Project {
  id: string
  name: string
  revision: number
  settings: { aspect: Aspect; width: number; height: number; fps: 30 | 60 }
  media: MediaItem[]
  video: VideoItem[]
  text: TextItem[]
  audio: AudioItem[]
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Inter', bold: true, sizePct: 8, color: '#ffffff', position: 'center', background: null
}

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }
}

export const MIN_ITEM_MS = 100

export function emptyProject(name: string): Project {
  return {
    id: globalThis.crypto.randomUUID(),
    name,
    revision: 0,
    settings: { aspect: '16:9', ...ASPECT_SIZE['16:9'], fps: 30 },
    media: [], video: [], text: [], audio: []
  }
}

export function timelineDurationMs(p: Project): number {
  const last = p.video[p.video.length - 1]
  if (last) return last.startMs + (last.outMs - last.inMs)
  let end = 0
  for (const t of p.text) end = Math.max(end, t.startMs + t.durationMs)
  for (const a of p.audio) end = Math.max(end, a.startMs + (a.outMs - a.inMs))
  return end
}

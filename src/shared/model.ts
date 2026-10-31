import type { ClipLook } from './look'
import type { TransitionType } from './transitions'
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

/** Per-clip framing: crop (fractions of the upright source), then rotate clockwise, then flip. */
export interface ClipTransform { rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; crop: { x: number; y: number; w: number; h: number } }
export const IDENTITY_TRANSFORM: ClipTransform = { rotate: 0, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } }

export interface VideoItem {
  id: ItemId; mediaId: MediaId; startMs: number; inMs: number; outMs: number; volume: number; transform?: ClipTransform; look?: ClipLook
  /** Transition from the previous clip into this one: the clips overlap by its length (see transitionMs). */
  transition?: { type: TransitionType; durationMs: number }
  /** Moves the sound's edit at the cut into this clip: + L-cut (previous sound runs on), − J-cut (this sound starts early). */
  audioCutMs?: number
}

/** How a text comes on / goes off. Every one also fades. */
export type TextAnim = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'pop'
export const TEXT_ANIMS: readonly TextAnim[] = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'pop']

export interface TextStyle {
  /** A family from the font library (list_fonts); unknown names fall back to Inter. */
  font: string
  bold: boolean
  sizePct: number
  color: string
  /** 'custom' places the block's centre at (x, y), fractions of the frame. */
  position: 'top' | 'center' | 'bottom' | 'custom'
  background: string | null
  x?: number
  y?: number
  /** Degrees clockwise around the block centre. */
  rotation?: number
  /** Letter outline; width in px at 1080p. Missing = thin black outline (when there's no background); null = none. */
  outline?: { color: string; width: number } | null
  /** Colour of a soft drop shadow, or null/missing for none. */
  shadow?: string | null
  /** Extra space between letters, in em (e.g. 0.1). */
  letterSpacing?: number
  uppercase?: boolean
  animIn?: TextAnim
  animOut?: TextAnim
  /** Length of the in/out animation (default 400ms, at most half the text's duration). */
  animMs?: number
}

export interface TextItem { id: ItemId; startMs: number; durationMs: number; text: string; style: TextStyle }
/** lane 0 is the music lane; missing lane means 0. */
export interface AudioItem { id: ItemId; mediaId: MediaId; startMs: number; inMs: number; outMs: number; volume: number; lane?: number }
export const laneOf = (a: AudioItem): number => a.lane ?? 0

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
/** A photo dropped on the timeline lasts this long (CapCut's default) and can be stretched up to STILL_MAX_MS. */
export const STILL_DEFAULT_MS = 5000
export const STILL_MAX_MS = 3_600_000

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

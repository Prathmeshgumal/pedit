import type { MediaItem } from '../../shared/model'
import { TONEMAP_VF } from './color'

const hdr = (m: MediaItem): string[] => (m.colorTransfer === 'sdr' ? [] : [TONEMAP_VF])

export function thumbArgs(m: MediaItem, out: string): string[] {
  // a photo has one frame: seeking (even to 0) would skip it
  const seek = m.kind === 'image' ? [] : ['-ss', Math.max(0, (m.durationMs * 0.1) / 1000).toFixed(3)]
  return [...seek, '-i', m.path, '-frames:v', '1', '-vf', ['scale=320:-2', ...hdr(m), 'format=yuvj420p'].join(','), '-q:v', '4', '-f', 'image2', out]
}

export const MAX_FILMSTRIP_FRAMES = 200

/** Preview copy of a photo: upright (ffmpeg applies EXIF rotation), at most 1920px on its long edge. */
export function stillArgs(m: MediaItem, out: string): string[] {
  return ['-i', m.path, '-frames:v', '1', '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease,format=yuvj420p", '-q:v', '3', '-f', 'image2', out]
}

export function filmstripArgs(m: MediaItem, out: string): string[] {
  // under 2s there may be just one keyframe, which the keyframe-only sampling below can miss: use the first frame
  if (m.durationMs < 2000) return ['-i', m.path, '-vf', ['scale=-2:160', ...hdr(m), 'format=yuvj420p'].join(','), '-frames:v', '1', '-q:v', '5', '-f', 'image2', out]
  const secs = Math.max(1, m.durationMs / 1000)
  const frames = Math.min(MAX_FILMSTRIP_FRAMES, Math.ceil(secs))
  const rate = frames / secs
  return ['-skip_frame', 'nokey', '-i', m.path, '-vf', [`fps=${rate.toFixed(6)}`, 'scale=-2:160', ...hdr(m), `tile=${frames}x1`, 'format=yuvj420p'].join(','),
    '-frames:v', '1', '-q:v', '5', '-f', 'image2', out]
}

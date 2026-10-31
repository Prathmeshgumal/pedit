import type { MediaItem } from '../../shared/model'
import { TONEMAP_VF } from './color'

const hdr = (m: MediaItem): string[] => (m.colorTransfer === 'sdr' ? [] : [TONEMAP_VF])

export function thumbArgs(m: MediaItem, out: string): string[] {
  const at = Math.max(0, (m.durationMs * 0.1) / 1000)
  return ['-ss', at.toFixed(3), '-i', m.path, '-frames:v', '1', '-vf', [...hdr(m), 'scale=320:-2', 'format=yuvj420p'].join(','), '-q:v', '4', '-f', 'image2', out]
}

export const MAX_FILMSTRIP_FRAMES = 200

export function filmstripArgs(m: MediaItem, out: string): string[] {
  const secs = Math.max(1, m.durationMs / 1000)
  const frames = Math.min(MAX_FILMSTRIP_FRAMES, Math.ceil(secs))
  const rate = frames / secs
  return ['-i', m.path, '-vf', [...hdr(m), `fps=${rate.toFixed(6)}`, 'scale=-2:160', `tile=${frames}x1`, 'format=yuvj420p'].join(','),
    '-frames:v', '1', '-q:v', '5', '-f', 'image2', out]
}

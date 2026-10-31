import { emptyProject, type MediaItem, type Project } from '@shared/model'

export const media = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({
  id, path: `/x/${id}.mp4`, name: `${id}.mp4`, folder: 'day1', kind: 'video', createdAt: '2026-03-01T10:00:00.000Z', importIndex: 0,
  durationMs: 5000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'ready', ...over
})

export function projectWith(items: MediaItem[]): Project {
  const p = emptyProject('t')
  p.media = items
  return p
}

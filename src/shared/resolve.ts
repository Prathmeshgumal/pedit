import type { ItemId, MediaItem, Project, TextItem, VideoItem } from './model'

export interface FrameAt { video: { item: VideoItem; media: MediaItem; sourceMs: number } | null; texts: TextItem[] }

export function resolveAt(p: Project, tMs: number): FrameAt {
  let video: FrameAt['video'] = null
  for (const v of p.video) {
    if (tMs >= v.startMs && tMs < v.startMs + v.outMs - v.inMs) {
      const media = p.media.find((m) => m.id === v.mediaId)
      if (media) video = { item: v, media, sourceMs: v.inMs + (tMs - v.startMs) }
      break
    }
  }
  return { video, texts: p.text.filter((t) => tMs >= t.startMs && tMs < t.startMs + t.durationMs) }
}

export function audibleAt(p: Project, tMs: number): Array<{ itemId: ItemId; media: MediaItem; sourceMs: number; volume: number }> {
  const out: Array<{ itemId: ItemId; media: MediaItem; sourceMs: number; volume: number }> = []
  for (const it of [...p.video, ...p.audio]) {
    if (tMs < it.startMs || tMs >= it.startMs + it.outMs - it.inMs) continue
    const media = p.media.find((m) => m.id === it.mediaId)
    if (!media?.hasAudio) continue
    out.push({ itemId: it.id, media, sourceMs: it.inMs + (tMs - it.startMs), volume: it.volume })
  }
  return out
}

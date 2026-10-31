import type { ItemId, Project } from '@shared/model'

export type Track = 'video' | 'text' | 'audio'
export const RULER_H = 22
export const HEADER_W = 64
/** y offsets are relative to the bottom of the ruler. */
export const TRACKS: Record<Track, { y: number; h: number; label: string }> = {
  text: { y: 6, h: 26, label: 'TEXT' },
  video: { y: 38, h: 58, label: 'VIDEO' },
  audio: { y: 102, h: 38, label: 'MUSIC' }
}
export const CONTENT_H = RULER_H + 146
export const EDGE_PX = 6

export interface LaidOut { id: ItemId; track: Track; x: number; w: number; startMs: number; endMs: number }

export function itemSpans(p: Project): Array<{ id: ItemId; track: Track; startMs: number; endMs: number }> {
  return [
    ...p.text.map((t) => ({ id: t.id, track: 'text' as const, startMs: t.startMs, endMs: t.startMs + t.durationMs })),
    ...p.video.map((v) => ({ id: v.id, track: 'video' as const, startMs: v.startMs, endMs: v.startMs + v.outMs - v.inMs })),
    ...p.audio.map((a) => ({ id: a.id, track: 'audio' as const, startMs: a.startMs, endMs: a.startMs + a.outMs - a.inMs }))
  ]
}

export const msToX = (ms: number, pxPerMs: number, scrollMs: number): number => HEADER_W + (ms - scrollMs) * pxPerMs
export const xToMs = (x: number, pxPerMs: number, scrollMs: number): number => (x - HEADER_W) / pxPerMs + scrollMs

export function layoutTimeline(p: Project, pxPerMs: number, scrollMs: number): LaidOut[] {
  const order: Track[] = ['video', 'text', 'audio']
  return itemSpans(p)
    .sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track))
    .map((s) => ({ ...s, x: msToX(s.startMs, pxPerMs, scrollMs), w: (s.endMs - s.startMs) * pxPerMs }))
}

export function trackAt(y: number): Track | null {
  for (const t of Object.keys(TRACKS) as Track[]) {
    const r = TRACKS[t]
    if (y >= RULER_H + r.y && y < RULER_H + r.y + r.h) return t
  }
  return null
}

export function hitTest(layout: LaidOut[], x: number, y: number): { id: ItemId; zone: 'body' | 'left-edge' | 'right-edge' } | null {
  const track = trackAt(y)
  if (!track || x < HEADER_W) return null
  for (const it of layout) {
    if (it.track !== track || x < it.x || x > it.x + it.w) continue
    const edge = Math.min(EDGE_PX, it.w / 3)
    if (x - it.x <= edge) return { id: it.id, zone: 'left-edge' }
    if (it.x + it.w - x <= edge) return { id: it.id, zone: 'right-edge' }
    return { id: it.id, zone: 'body' }
  }
  return null
}

export function snapMs(ms: number, candidates: number[], tolPx: number, pxPerMs: number): number {
  let best = ms
  let bestPx = tolPx
  for (const c of candidates) {
    const d = Math.abs(c - ms) * pxPerMs
    if (d <= bestPx) { bestPx = d; best = c }
  }
  return best
}

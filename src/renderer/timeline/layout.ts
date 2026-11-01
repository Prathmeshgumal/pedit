import { laneOf, type ItemId, type Project } from '@shared/model'
import { transitionMs } from '@shared/transitions'

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
const LANE_STEP = 44

/** One horizontal row of the timeline. Audio has one row per lane in use plus an empty row to drop on. */
export interface TrackRow { key: string; kind: Track; lane: number; y: number; h: number; label: string }

export function trackRows(p: Project): TrackRow[] {
  const rows: TrackRow[] = [{ key: 'text', kind: 'text', lane: 0, ...TRACKS.text }, { key: 'video', kind: 'video', lane: 0, ...TRACKS.video }]
  const lanes = [...new Set([0, ...p.audio.map(laneOf)])].sort((a, b) => a - b)
  let y = TRACKS.audio.y
  for (const lane of lanes) {
    rows.push({ key: `audio:${lane}`, kind: 'audio', lane, y, h: TRACKS.audio.h, label: lane === 0 ? 'MUSIC' : `AUDIO ${lane + 1}` })
    y += LANE_STEP
  }
  if (p.audio.length) rows.push({ key: 'audio:new', kind: 'audio', lane: lanes[lanes.length - 1] + 1, y, h: 26, label: '+ AUDIO' })
  return rows
}

export const contentHeight = (rows: TrackRow[]): number => Math.max(CONTENT_H, RULER_H + Math.max(...rows.map((r) => r.y + r.h)) + 6)

export const rowKeyOf = (track: Track, lane = 0): string => (track === 'audio' ? `audio:${lane}` : track)

export function rowAt(rows: TrackRow[], y: number): TrackRow | null {
  return rows.find((r) => y >= RULER_H + r.y && y < RULER_H + r.y + r.h) ?? null
}

export interface LaidOut { id: ItemId; track: Track; row: string; x: number; w: number; startMs: number; endMs: number }

export function itemSpans(p: Project): Array<{ id: ItemId; track: Track; row: string; startMs: number; endMs: number }> {
  return [
    ...p.text.map((t) => ({ id: t.id, track: 'text' as const, row: 'text', startMs: t.startMs, endMs: t.startMs + t.durationMs })),
    ...p.video.map((v) => ({ id: v.id, track: 'video' as const, row: 'video', startMs: v.startMs, endMs: v.startMs + v.outMs - v.inMs })),
    ...p.audio.map((a) => ({ id: a.id, track: 'audio' as const, row: rowKeyOf('audio', laneOf(a)), startMs: a.startMs, endMs: a.startMs + a.outMs - a.inMs }))
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

export function hitTest(layout: LaidOut[], rows: TrackRow[], x: number, y: number): { id: ItemId; zone: 'body' | 'left-edge' | 'right-edge' } | null {
  const row = rowAt(rows, y)
  if (!row || x < HEADER_W) return null
  const zoneOf = (it: LaidOut): 'body' | 'left-edge' | 'right-edge' => {
    const edge = Math.min(EDGE_PX, it.w / 3)
    return x - it.x <= edge ? 'left-edge' : it.x + it.w - x <= edge ? 'right-edge' : 'body'
  }
  const inRow = layout.filter((it) => it.row === row.key && x >= it.x && x <= it.x + it.w)
  if (!inRow.length) return null
  // two clips overlap under a transition: the incoming one is drawn on top, so it wins unless the pointer is on its left edge
  const top = inRow[inRow.length - 1]
  const hit = inRow.length > 1 && zoneOf(top) !== 'left-edge' ? top : inRow[0]
  return { id: hit.id, zone: zoneOf(hit) }
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

/** The button at a cut between two video clips (click → transition menu). `id` is the incoming clip. */
export interface CutBadge { id: ItemId; x: number; y: number; ms: number; overlapX: number; overlapW: number; has: boolean }
export const BADGE_R = 8

export function cutBadges(p: Project, rows: TrackRow[], pxPerMs: number, scrollMs: number): CutBadge[] {
  const row = rows.find((r) => r.key === 'video')
  if (!row) return []
  const out: CutBadge[] = []
  for (let i = 1; i < p.video.length; i++) {
    const v = p.video[i], prev = p.video[i - 1]
    // too zoomed out to fit a button between the two clips
    if (Math.min(v.outMs - v.inMs, prev.outMs - prev.inMs) * pxPerMs < BADGE_R * 3) continue
    const d = transitionMs(p.video, i)
    const ms = v.startMs + d / 2
    out.push({ id: v.id, ms, x: msToX(ms, pxPerMs, scrollMs), y: RULER_H + row.y + row.h - BADGE_R - 3, overlapX: msToX(v.startMs, pxPerMs, scrollMs), overlapW: d * pxPerMs, has: d > 0 })
  }
  return out
}

export const badgeAt = (badges: CutBadge[], x: number, y: number): CutBadge | null =>
  badges.find((b) => Math.hypot(x - b.x, y - b.y) <= BADGE_R + 1) ?? null

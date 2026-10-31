import type { Command } from '@shared/commands'
import type { Project } from '@shared/model'
import { itemSpans, type Track } from './layout'

export type Zone = 'body' | 'left-edge' | 'right-edge'

/** Edges the dragged item may snap to (other items' edges, playhead, zero). */
export function snapCandidates(p: Project, exceptId: string, playheadMs: number): number[] {
  const c = [0, playheadMs]
  for (const s of itemSpans(p)) if (s.id !== exceptId) c.push(s.startMs, s.endMs)
  return c
}

/** Translate a finished drag (time delta in ms) into one edit command, or null for no-op. */
export function dragToCommand(p: Project, id: string, track: Track, zone: Zone, dxMs: number, lane?: number): Command | null {
  const dx = Math.round(dxMs)
  if (track === 'audio' && zone === 'body' && lane !== undefined) {
    const a = p.audio.find((i) => i.id === id)!
    if (lane !== (a.lane ?? 0)) return { type: 'moveItem', id, toMs: Math.max(0, a.startMs + dx), lane }
  }
  if (dx === 0) return null
  if (track === 'text') {
    const t = p.text.find((i) => i.id === id)!
    if (zone === 'body') return { type: 'moveItem', id, toMs: Math.max(0, t.startMs + dx) }
    if (zone === 'left-edge') return { type: 'updateText', id, startMs: Math.max(0, t.startMs + dx), durationMs: t.durationMs - Math.max(-t.startMs, dx) }
    return { type: 'updateText', id, durationMs: t.durationMs + dx }
  }
  const it = (track === 'video' ? p.video : p.audio).find((i) => i.id === id)!
  if (zone === 'body') return { type: 'moveItem', id, toMs: Math.max(0, it.startMs + dx) }
  if (zone === 'left-edge') return { type: 'trimItem', id, inMs: it.inMs + dx }
  return { type: 'trimItem', id, outMs: it.outMs + dx }
}

/** Item to split with S: the selected item if the playhead is inside it, else the video clip under the playhead. */
export function splitTarget(p: Project, selected: string | null, playheadMs: number): string | null {
  const inside = (s: { startMs: number; endMs: number }): boolean => playheadMs > s.startMs && playheadMs < s.endMs
  const spans = itemSpans(p)
  const sel = spans.find((s) => s.id === selected)
  if (sel && inside(sel)) return sel.id
  return spans.find((s) => s.track === 'video' && inside(s))?.id ?? null
}

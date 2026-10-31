import { describe, it, expect } from 'vitest'
import { layoutTimeline, hitTest, snapMs, trackRows, rowAt, TRACKS, RULER_H, HEADER_W } from '../../src/renderer/timeline/layout'
import { applyCommand, type Command } from '@shared/commands'
import { seqIds } from '@shared/ids'
import { media, projectWith } from './helpers'

function build() {
  const ids = seqIds()
  let p = projectWith([media('m_a', { durationMs: 4000 }), media('m_b', { durationMs: 2000 }), media('m_t', { kind: 'audio', durationMs: 30000 })])
  const cmds: Command[] = [{ type: 'addClip', mediaId: 'm_a' }, { type: 'addClip', mediaId: 'm_b' },
    { type: 'addText', text: 'hi', startMs: 1000, durationMs: 1000 }, { type: 'setMusic', mediaId: 'm_t' }]
  for (const c of cmds) p = applyCommand(p, c, ids).project
  return p
}

describe('timeline layout', () => {
  it('maps items to x/width proportional to time', () => {
    const l = layoutTimeline(build(), 0.1, 0)
    const v = l.filter((i) => i.track === 'video')
    expect(v.map((i) => [i.x, i.w])).toEqual([[HEADER_W, 400], [HEADER_W + 400, 200]])
    expect(l.find((i) => i.track === 'text')).toMatchObject({ x: HEADER_W + 100, w: 100 })
  })
  it('scrolling shifts x', () => {
    expect(layoutTimeline(build(), 0.1, 1000)[0].x).toBe(HEADER_W - 100)
  })
  it('hit-tests edges within 6px and bodies', () => {
    const p = build()
    const l = layoutTimeline(p, 0.1, 0)
    const rows = trackRows(p)
    const y = RULER_H + TRACKS.video.y + 10
    expect(hitTest(l, rows, HEADER_W + 397, y)).toEqual({ id: 'c_000001', zone: 'right-edge' })
    expect(hitTest(l, rows, HEADER_W + 2, y)).toEqual({ id: 'c_000001', zone: 'left-edge' })
    expect(hitTest(l, rows, HEADER_W + 200, y)).toEqual({ id: 'c_000001', zone: 'body' })
    expect(hitTest(l, rows, HEADER_W + 200, RULER_H + TRACKS.audio.y + 5)).toEqual({ id: 'a_000004', zone: 'body' })
    expect(hitTest(l, rows, HEADER_W + 900, y)).toBeNull()
  })
  it('snaps only within the pixel tolerance', () => {
    expect(snapMs(4060, [4000, 6000], 8, 0.1)).toBe(4000)
    expect(snapMs(4100, [4000, 6000], 8, 0.1)).toBe(4100)
  })
  it('audio lanes get one row each plus an empty row to drop on', () => {
    const p = build()
    p.audio.push({ id: 'a_x', mediaId: 'm_t', startMs: 0, inMs: 0, outMs: 1000, volume: 1, lane: 2 })
    const rows = trackRows(p)
    expect(rows.map((r) => r.key)).toEqual(['text', 'video', 'audio:0', 'audio:2', 'audio:new'])
    expect(rows.find((r) => r.key === 'audio:new')!.lane).toBe(3)
    const lane2 = rows.find((r) => r.key === 'audio:2')!
    expect(rowAt(rows, RULER_H + lane2.y + 3)?.key).toBe('audio:2')
    const l = layoutTimeline(p, 0.1, 0)
    expect(hitTest(l, rows, HEADER_W + 50, RULER_H + lane2.y + 5)).toEqual({ id: 'a_x', zone: 'body' })
  })
  it('a project with no audio still has one music row', () => {
    const p = build(); p.audio = []
    expect(trackRows(p).map((r) => r.key)).toEqual(['text', 'video', 'audio:0'])
  })
})

import { describe, it, expect } from 'vitest'
import { resolveAt, audibleAt } from '@shared/resolve'
import { applyCommand, type Command } from '@shared/commands'
import { seqIds } from '@shared/ids'
import { media, projectWith } from './helpers'

function build() {
  const ids = seqIds()
  let p = projectWith([media('m_a'), media('m_b', { hasAudio: false }), media('m_t', { kind: 'audio', durationMs: 30000 })])
  const cmds: Command[] = [
    { type: 'addClip', mediaId: 'm_a', inMs: 1000, outMs: 4000 }, { type: 'addClip', mediaId: 'm_b', inMs: 500, outMs: 2500 },
    { type: 'addText', text: 'hi', startMs: 2500, durationMs: 1000 }, { type: 'setMusic', mediaId: 'm_t', volume: 0.5 }
  ]
  for (const c of cmds) p = applyCommand(p, c, ids).project
  return p
}

describe('resolve', () => {
  it('finds the clip under the playhead with source time', () => {
    const p = build()
    expect(resolveAt(p, 1000).video).toMatchObject({ item: { id: 'c_000001' }, sourceMs: 2000 })
    expect(resolveAt(p, 3000).video).toMatchObject({ item: { id: 'c_000002' }, sourceMs: 500 })
    expect(resolveAt(p, 5000).video).toBeNull()
    expect(resolveAt(p, 3000).texts.map((t) => t.id)).toEqual(['t_000003'])
    expect(resolveAt(p, 3500).texts).toEqual([])
  })
  it('lists audible sources, skipping clips without audio', () => {
    const p = build()
    expect(audibleAt(p, 1000).map((a) => [a.itemId, a.sourceMs, a.volume])).toEqual([['c_000001', 2000, 1], ['a_000004', 1000, 0.5]])
    expect(audibleAt(p, 3500).map((a) => a.itemId)).toEqual(['a_000004'])
  })
})

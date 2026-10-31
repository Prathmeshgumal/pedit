import { describe, it, expect } from 'vitest'
import { applyCommand, CommandError } from '@shared/commands'
import { emptyProject, type MediaItem } from '@shared/model'
import { seqIds } from '@shared/ids'

const m = (id: string): MediaItem => ({
  id, path: `/x/${id}.mp4`, name: `${id}.mp4`, folder: 'x', kind: 'video', createdAt: '2026-03-01T10:00:00.000Z', importIndex: 0,
  durationMs: 5000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'processing'
})

describe('media commands', () => {
  it('addMedia appends and summarizes', () => {
    const p = emptyProject('x')
    const before = structuredClone(p)
    const r = applyCommand(p, { type: 'addMedia', items: [m('m_1'), m('m_2')] }, seqIds())
    expect(r.project.media.map((x) => x.id)).toEqual(['m_1', 'm_2'])
    expect(r.summary).toBe('added 2 media')
    expect(p).toEqual(before)
    expect(r.project.revision).toBe(0)
  })
  it('updateMedia patches by id', () => {
    const p = applyCommand(emptyProject('x'), { type: 'addMedia', items: [m('m_1')] }, seqIds()).project
    const r = applyCommand(p, { type: 'updateMedia', id: 'm_1', patch: { status: 'ready', proxyPath: '/c/p.mp4' } }, seqIds())
    expect(r.project.media[0]).toMatchObject({ status: 'ready', proxyPath: '/c/p.mp4' })
  })
  it('updateMedia on unknown id throws not_found', () => {
    try {
      applyCommand(emptyProject('x'), { type: 'updateMedia', id: 'm_9', patch: {} }, seqIds())
      throw new Error('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(CommandError)
      expect((e as CommandError).code).toBe('not_found')
    }
  })
})

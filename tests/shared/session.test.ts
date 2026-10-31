import { describe, it, expect } from 'vitest'
import { EditSession, RevisionMismatch } from '@shared/session'
import { seqIds } from '@shared/ids'
import { media, projectWith } from './helpers'

const fresh = (): EditSession => new EditSession(projectWith([media('m_a'), media('m_b')]), seqIds())

describe('EditSession', () => {
  it('user edits without a draft bump revision and undo restores', () => {
    const s = fresh()
    s.apply({ type: 'addClip', mediaId: 'm_a' }, 'user')
    expect(s.state().real.revision).toBe(1)
    expect(s.state().view.video).toHaveLength(1)
    s.undo()
    expect(s.state().view.video).toHaveLength(0)
    s.redo()
    expect(s.state().view.video).toHaveLength(1)
  })

  it('draft edits leave real untouched and report a diff', () => {
    const s = fresh()
    s.apply({ type: 'addClip', mediaId: 'm_a' }, 'user')
    s.startDraft()
    s.apply({ type: 'addClip', mediaId: 'm_b' }, 'claude')
    s.apply({ type: 'addText', text: 'Tokyo', startMs: 0, durationMs: 1000 }, 'claude')
    s.apply({ type: 'trimItem', id: 'c_000001', outMs: 3000 }, 'user')
    const st = s.state()
    expect(st.draftActive).toBe(true)
    expect(st.real.video).toHaveLength(1)
    expect(st.view.video).toHaveLength(2)
    expect(st.diff).toEqual({ added: ['c_000002', 't_000003'], removed: [], changed: ['c_000001'] })
    expect(st.viewRevision).toBe(4)
    expect(s.takeUserEditsSinceLastTurn()).toEqual(['trimmed c_000001 (m_a.mp4) to 0:03.0 (was 0:05.0)'])
    expect(s.takeUserEditsSinceLastTurn()).toEqual([])
    s.undo()
    expect(s.state().view.video[0].outMs).toBe(5000)
    expect(s.state().view.text).toHaveLength(1)
  })

  it('accept applies the draft as one undo step', () => {
    const s = fresh()
    s.startDraft()
    s.apply({ type: 'addClip', mediaId: 'm_a' }, 'claude')
    s.apply({ type: 'addClip', mediaId: 'm_b' }, 'claude')
    s.acceptDraft()
    expect(s.state()).toMatchObject({ draftActive: false, diff: null })
    expect(s.state().real.revision).toBe(1)
    expect(s.state().real.video).toHaveLength(2)
    s.undo()
    expect(s.state().real.video).toHaveLength(0)
  })

  it('reject returns to the real timeline', () => {
    const s = fresh()
    s.startDraft()
    s.apply({ type: 'addClip', mediaId: 'm_a' }, 'claude')
    s.rejectDraft()
    expect(s.state().view.video).toHaveLength(0)
    expect(s.state().draftActive).toBe(false)
  })

  it('stale expectedRevision throws RevisionMismatch', () => {
    const s = fresh()
    s.startDraft()
    s.apply({ type: 'addClip', mediaId: 'm_a' }, 'claude', 0)
    expect(() => s.apply({ type: 'addClip', mediaId: 'm_b' }, 'claude', 0)).toThrow(RevisionMismatch)
    s.apply({ type: 'addClip', mediaId: 'm_b' }, 'claude', 1)
  })

  it('media changes reach real and draft, survive reject, and are not undone', () => {
    const s = fresh()
    s.startDraft()
    s.apply({ type: 'addMedia', items: [media('m_c')] }, 'user')
    s.apply({ type: 'updateMedia', id: 'm_a', patch: { status: 'processing' } }, 'user')
    s.rejectDraft()
    expect(s.state().real.media.map((m) => m.id)).toEqual(['m_a', 'm_b', 'm_c'])
    s.apply({ type: 'addClip', mediaId: 'm_c' }, 'user')
    s.undo()
    expect(s.state().real.media).toHaveLength(3)
    expect(s.state().real.media[0].status).toBe('processing')
  })

  it('notifies listeners on change', () => {
    const s = fresh()
    let n = 0
    const off = s.onChange(() => n++)
    s.apply({ type: 'addClip', mediaId: 'm_a' }, 'user')
    off()
    s.undo()
    expect(n).toBe(1)
  })
})

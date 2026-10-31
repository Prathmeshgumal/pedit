import { describe, it, expect } from 'vitest'
import { timelineSummary, mediaSummary, fmtTime } from '@shared/summary'
import { applyCommand } from '@shared/commands'
import { seqIds } from '@shared/ids'
import { media, projectWith } from './helpers'

describe('summaries', () => {
  it('formats times', () => {
    expect(fmtTime(3000)).toBe('0:03.0')
    expect(fmtTime(83450)).toBe('1:23.4')
  })

  it('prints the timeline in the fixed format', () => {
    const ids = seqIds()
    let p = projectWith([media('m_s', { name: 'shrine.mov', durationMs: 10000 }), media('m_t', { name: 'track_02.mp3', kind: 'audio', durationMs: 30000 })])
    for (const c of [
      { type: 'setFormat', aspect: '9:16' }, { type: 'addClip', mediaId: 'm_s', inMs: 5000, outMs: 8000 },
      { type: 'addText', text: 'Tokyo', startMs: 0, durationMs: 2000 }, { type: 'setMusic', mediaId: 'm_t', volume: 0.8 }
    ] as const) p = applyCommand(p, c, ids).project
    expect(timelineSummary(p, { draft: true, revision: 7 })).toBe(
      'rev 7 · DRAFT · 9:16 1080x1920 30fps · length 0:03.0\n' +
      'VIDEO\n  c_000001 0:00.0-0:03.0 shrine.mov [src 0:05.0-0:08.0]\n' +
      'TEXT\n  t_000002 0:00.0-0:02.0 "Tokyo" (center)\n' +
      'MUSIC\n  a_000003 0:00.0-0:30.0 track_02.mp3 vol 80%')
  })

  it('prints empty tracks and omits DRAFT', () => {
    expect(timelineSummary(projectWith([]), { draft: false, revision: 0 })).toBe(
      'rev 0 · 16:9 1920x1080 30fps · length 0:00.0\nVIDEO\n  (empty)\nTEXT\n  (empty)\nMUSIC\n  (empty)')
  })

  it('lists media by capture time', () => {
    const p = projectWith([
      media('m_2', { name: 'b.mov', createdAt: '2026-03-01T11:00:00.000Z', hasAudio: false, importIndex: 0 }),
      media('m_1', { name: 'shrine.mov', width: 3840, height: 2160, fps: 120, importIndex: 1 }),
      media('m_3', { name: 'gone.mov', status: 'offline', createdAt: '2026-03-02T09:30:00.000Z' })
    ])
    expect(mediaSummary(p)).toBe(
      'm_1 shrine.mov · folder day1 · 2026-03-01 10:00 · 0:05.0 · 3840x2160 120fps · audio\n' +
      'm_2 b.mov · folder day1 · 2026-03-01 11:00 · 0:05.0 · 1920x1080 30fps · no audio\n' +
      'm_3 gone.mov · folder day1 · 2026-03-02 09:30 · 0:05.0 · 1920x1080 30fps · audio · OFFLINE')
  })

  it('lists photos without a length', () => {
    const p = projectWith([media('m_p', { name: 'IMG_1.jpg', kind: 'image', width: 3024, height: 4032, durationMs: 0, fps: 0, hasAudio: false })])
    expect(mediaSummary(p)).toBe('m_p IMG_1.jpg · folder day1 · 2026-03-01 10:00 · photo · 3024x4032')
  })
})

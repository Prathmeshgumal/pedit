import { describe, it, expect } from 'vitest'
import { emptyProject, timelineDurationMs, ASPECT_SIZE, DEFAULT_TEXT_STYLE } from '@shared/model'
import { seqIds } from '@shared/ids'

describe('model', () => {
  it('emptyProject starts at revision 0, 1920x1080, 30fps, empty tracks', () => {
    const p = emptyProject('x')
    expect(p.name).toBe('x')
    expect(p.revision).toBe(0)
    expect(p.settings).toEqual({ aspect: '16:9', width: 1920, height: 1080, fps: 30 })
    expect([p.media, p.video, p.text, p.audio]).toEqual([[], [], [], []])
  })

  it('timelineDurationMs is the end of the last video item', () => {
    const p = emptyProject('x')
    p.video = [
      { id: 'c_1', mediaId: 'm_1', startMs: 0, inMs: 0, outMs: 3000, volume: 1 },
      { id: 'c_2', mediaId: 'm_1', startMs: 3000, inMs: 0, outMs: 2000, volume: 1 }
    ]
    expect(timelineDurationMs(p)).toBe(5000)
  })

  it('timelineDurationMs falls back to text/audio ends without video', () => {
    const p = emptyProject('x')
    p.text = [{ id: 't_1', startMs: 1000, durationMs: 2500, text: 'a', style: DEFAULT_TEXT_STYLE }]
    expect(timelineDurationMs(p)).toBe(3500)
  })

  it('aspect sizes are fixed', () => {
    expect(ASPECT_SIZE['9:16']).toEqual({ width: 1080, height: 1920 })
    expect(ASPECT_SIZE['1:1']).toEqual({ width: 1080, height: 1080 })
  })

  it('seqIds produces prefixed sequential ids', () => {
    const ids = seqIds()
    expect([ids('c'), ids('c'), ids('m')]).toEqual(['c_000001', 'c_000002', 'm_000003'])
  })
})

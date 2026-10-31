import { describe, it, expect } from 'vitest'
import { applyCommand, CommandError, type Command } from '@shared/commands'
import { emptyProject, type MediaItem, type Project } from '@shared/model'
import { seqIds, type IdGen } from '@shared/ids'

const media = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({
  id, path: `/x/${id}.mp4`, name: `${id}.mp4`, folder: 'x', kind: 'video', createdAt: '2026-03-01T10:00:00.000Z', importIndex: 0,
  durationMs: 5000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'ready', ...over
})

function setup(): { p: Project; ids: IdGen; run: (c: Command) => Project; err: (c: Command) => string } {
  const ids = seqIds()
  let p = emptyProject('t')
  p.media = [media('m_a'), media('m_b'), media('m_c'), media('m_song', { kind: 'audio', durationMs: 30000, width: 0, height: 0 })]
  const run = (c: Command): Project => (p = applyCommand(p, c, ids).project)
  const err = (c: Command): string => {
    try { applyCommand(p, c, ids) } catch (e) { if (e instanceof CommandError) return e.code; throw e }
    return 'no error'
  }
  return { get p() { return p }, ids, run, err } as unknown as ReturnType<typeof setup>
}

const starts = (p: Project): number[] => p.video.map((v) => v.startMs)

describe('video track (ripple)', () => {
  it('adds clips end to end', () => {
    const s = setup()
    for (const m of ['m_a', 'm_b', 'm_c']) s.run({ type: 'addClip', mediaId: m })
    expect(starts(s.p)).toEqual([0, 5000, 10000])
    expect(s.p.video[0]).toMatchObject({ id: 'c_000001', inMs: 0, outMs: 5000, volume: 1 })
  })
  it('inserts first with after:null and ripples the rest', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' })
    s.run({ type: 'addClip', mediaId: 'm_b', after: null })
    expect(s.p.video.map((v) => v.mediaId)).toEqual(['m_b', 'm_a'])
    expect(starts(s.p)).toEqual([0, 5000])
  })
  it('atMs lands on the nearest boundary', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' }); s.run({ type: 'addClip', mediaId: 'm_b' })
    s.run({ type: 'addClip', mediaId: 'm_c', atMs: 7400 })
    expect(s.p.video.map((v) => v.mediaId)).toEqual(['m_a', 'm_c', 'm_b'])
  })
  it('trimming ripples following clips', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' }); s.run({ type: 'addClip', mediaId: 'm_b' })
    const r = applyCommand(s.p, { type: 'trimItem', id: 'c_000001', outMs: 3000 }, s.ids)
    expect(starts(r.project)).toEqual([0, 3000])
    expect(r.summary).toBe('trimmed c_000001 (m_a.mp4) to 0:03.0 (was 0:05.0)')
  })
  it('rejects trims shorter than 100ms and clamps to media length', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' })
    expect(s.err({ type: 'trimItem', id: 'c_000001', inMs: 4950 })).toBe('invalid')
    s.run({ type: 'trimItem', id: 'c_000001', inMs: -500, outMs: 9999 })
    expect(s.p.video[0]).toMatchObject({ inMs: 0, outMs: 5000 })
  })
  it('splits at a timeline time into two items', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' })
    s.run({ type: 'splitItem', id: 'c_000001', atMs: 2000 })
    expect(s.p.video.map((v) => [v.id, v.startMs, v.inMs, v.outMs])).toEqual([['c_000001', 0, 0, 2000], ['c_000002', 2000, 2000, 5000]])
  })
  it('remove closes the gap; move reorders', () => {
    const s = setup()
    for (const m of ['m_a', 'm_b', 'm_c']) s.run({ type: 'addClip', mediaId: m })
    s.run({ type: 'removeItem', id: 'c_000002' })
    expect(starts(s.p)).toEqual([0, 5000])
    s.run({ type: 'moveItem', id: 'c_000003', after: null })
    expect(s.p.video.map((v) => v.id)).toEqual(['c_000003', 'c_000001'])
  })
  it('refuses audio-only media on the video track', () => {
    expect(setup().err({ type: 'addClip', mediaId: 'm_song' })).toBe('invalid')
  })
})

describe('text and music tracks', () => {
  it('rejects overlapping text', () => {
    const s = setup()
    s.run({ type: 'addText', text: 'Tokyo', startMs: 0, durationMs: 2000 })
    expect(s.err({ type: 'addText', text: 'x', startMs: 1500, durationMs: 1000 })).toBe('overlap')
    s.run({ type: 'addText', text: 'y', startMs: 2000, durationMs: 1000 })
    expect(s.p.text.map((t) => t.text)).toEqual(['Tokyo', 'y'])
    expect(s.p.text[0].style.sizePct).toBe(8)
  })
  it('updates text and moves it by toMs', () => {
    const s = setup()
    s.run({ type: 'addText', text: 'a', startMs: 0, durationMs: 1000 })
    s.run({ type: 'updateText', id: 't_000001', text: 'b', style: { color: '#ff0000' } })
    s.run({ type: 'moveItem', id: 't_000001', toMs: 4000 })
    expect(s.p.text[0]).toMatchObject({ text: 'b', startMs: 4000, style: { color: '#ff0000', bold: true } })
  })
  it('setMusic replaces existing music', () => {
    const s = setup()
    s.run({ type: 'setMusic', mediaId: 'm_song' })
    s.run({ type: 'setMusic', mediaId: 'm_song', inMs: 1000, volume: 0.8 })
    expect(s.p.audio).toHaveLength(1)
    expect(s.p.audio[0]).toMatchObject({ startMs: 0, inMs: 1000, outMs: 30000, volume: 0.8 })
  })
  it('setVolume is limited to 0..2', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' })
    expect(s.err({ type: 'setVolume', id: 'c_000001', volume: 3 })).toBe('invalid')
    s.run({ type: 'setVolume', id: 'c_000001', volume: 0.5 })
    expect(s.p.video[0].volume).toBe(0.5)
  })
})

describe('project-wide', () => {
  it('setFormat changes frame size', () => {
    const s = setup()
    s.run({ type: 'setFormat', aspect: '9:16' })
    expect(s.p.settings).toMatchObject({ aspect: '9:16', width: 1080, height: 1920 })
  })
  it('unknown ids are not_found; unknown media is media_not_found', () => {
    const s = setup()
    expect(s.err({ type: 'removeItem', id: 'c_999' })).toBe('not_found')
    expect(s.err({ type: 'addClip', mediaId: 'm_zzz' })).toBe('media_not_found')
  })
  it('never mutates the input project or its revision', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' })
    const before = structuredClone(s.p)
    const r = applyCommand(s.p, { type: 'splitItem', id: 'c_000001', atMs: 1000 }, s.ids)
    expect(s.p).toEqual(before)
    expect(r.project.revision).toBe(before.revision)
  })
})

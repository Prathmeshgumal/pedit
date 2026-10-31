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
  it('trimming the left edge of music keeps the rest of the song in place', () => {
    const s = setup()
    s.run({ type: 'setMusic', mediaId: 'm_song' })
    s.run({ type: 'moveItem', id: 'a_000001', toMs: 2000 })
    s.run({ type: 'trimItem', id: 'a_000001', inMs: 3000 })
    expect(s.p.audio[0]).toMatchObject({ startMs: 5000, inMs: 3000, outMs: 30000 })
    s.run({ type: 'trimItem', id: 'a_000001', inMs: 0 })
    expect(s.p.audio[0]).toMatchObject({ startMs: 2000, inMs: 0 })
  })
  it('cannot drag music start before the timeline start', () => {
    const s = setup()
    s.run({ type: 'setMusic', mediaId: 'm_song', inMs: 5000 })
    s.run({ type: 'moveItem', id: 'a_000001', toMs: 1000 })
    s.run({ type: 'trimItem', id: 'a_000001', inMs: 0 })
    expect(s.p.audio[0]).toMatchObject({ startMs: 0, inMs: 4000 })
  })
  it('setVolume is limited to 0..2', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' })
    expect(s.err({ type: 'setVolume', id: 'c_000001', volume: 3 })).toBe('invalid')
    s.run({ type: 'setVolume', id: 'c_000001', volume: 0.5 })
    expect(s.p.video[0].volume).toBe(0.5)
  })
})

describe('photos', () => {
  const withPhoto = () => { const s = setup(); s.p.media.push(media('m_photo', { kind: 'image', durationMs: 0, fps: 0, hasAudio: false })); return s }
  it('a photo becomes a 5 second clip, or as long as asked', () => {
    const s = withPhoto()
    s.run({ type: 'addClip', mediaId: 'm_photo' })
    s.run({ type: 'addClip', mediaId: 'm_photo', inMs: 0, outMs: 12000 })
    expect(s.p.video.map((v) => v.outMs - v.inMs)).toEqual([5000, 12000])
  })
  it('a photo clip can be stretched to any length and split', () => {
    const s = withPhoto()
    s.run({ type: 'addClip', mediaId: 'm_photo' })
    s.run({ type: 'trimItem', id: 'c_000001', outMs: 60000 })
    s.run({ type: 'splitItem', id: 'c_000001', atMs: 20000 })
    expect(s.p.video.map((v) => v.outMs - v.inMs)).toEqual([20000, 40000])
  })
})

describe('ids', () => {
  it('never reuses an id that is already on the timeline', () => {
    const s = setup()
    s.run({ type: 'addClip', mediaId: 'm_a' })
    let calls = 0
    const dup: IdGen = (pre) => (++calls === 1 ? `${pre}_000001` : `${pre}_fresh${calls}`)
    const r = applyCommand(s.p, { type: 'addClip', mediaId: 'm_b' }, dup)
    expect(r.project.video.map((v) => v.id)).toEqual(['c_000001', 'c_fresh2'])
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

describe('batch 1 commands', () => {
  const clip = (s: ReturnType<typeof setup>, m = 'm_a'): void => { s.run({ type: 'addClip', mediaId: m }) }

  it('setTransform merges and clamps crop', () => {
    const s = setup(); clip(s)
    s.run({ type: 'setTransform', id: 'c_000001', transform: { rotate: 90 } })
    s.run({ type: 'setTransform', id: 'c_000001', transform: { flipH: true } })
    expect(s.p.video[0].transform).toEqual({ rotate: 90, flipH: true, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } })
    expect(s.err({ type: 'setTransform', id: 'c_000001', transform: { crop: { x: -1, y: 0, w: 2, h: 0.01 } } })).toBe('invalid')
    s.run({ type: 'setTransform', id: 'c_000001', transform: { crop: { x: 0.25, y: 0, w: 0.5, h: 1 } } })
    expect(s.p.video[0].transform!.crop).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
  })

  it('extractAudio puts the clip sound on a free lane and mutes the clip', () => {
    const s = setup(); clip(s)
    s.run({ type: 'setMusic', mediaId: 'm_song' })
    s.run({ type: 'extractAudio', id: 'c_000001' })
    const extracted = s.p.audio.find((a) => a.mediaId === 'm_a')!
    expect(extracted).toMatchObject({ startMs: 0, inMs: 0, outMs: 5000, volume: 1, lane: 1 })
    expect(s.p.video[0].volume).toBe(0)
    s.p.media.push({ ...s.p.media[1], id: 'm_mute', hasAudio: false })
    s.run({ type: 'addClip', mediaId: 'm_mute' })
    expect(s.err({ type: 'extractAudio', id: s.p.video[1].id })).toBe('invalid')
  })

  it('extracted audio goes to lane 0 when it is free', () => {
    const s = setup(); clip(s)
    s.run({ type: 'extractAudio', id: 'c_000001' })
    expect(s.p.audio[0].lane ?? 0).toBe(0)
  })

  it('setMusic replaces only the music lane', () => {
    const s = setup(); clip(s)
    s.run({ type: 'setMusic', mediaId: 'm_song' })
    s.run({ type: 'extractAudio', id: 'c_000001' })
    s.run({ type: 'setMusic', mediaId: 'm_song', volume: 0.5 })
    expect(s.p.audio.map((a) => [a.mediaId, a.lane ?? 0])).toEqual([['m_a', 1], ['m_song', 0]])
  })

  it('removeMedia refuses media in use unless forced', () => {
    const s = setup(); clip(s); clip(s, 'm_b'); clip(s)
    expect(s.err({ type: 'removeMedia', id: 'm_a' })).toBe('in_use')
    s.run({ type: 'removeMedia', id: 'm_c' })
    expect(s.p.media.some((m) => m.id === 'm_c')).toBe(false)
    s.run({ type: 'removeMedia', id: 'm_a', force: true })
    expect(s.p.video.map((v) => [v.mediaId, v.startMs])).toEqual([['m_b', 0]])
  })

  it('duplicateItem copies right after the original', () => {
    const s = setup(); clip(s); clip(s, 'm_b')
    s.run({ type: 'duplicateItem', id: 'c_000001' })
    expect(s.p.video.map((v) => [v.mediaId, v.startMs])).toEqual([['m_a', 0], ['m_a', 5000], ['m_b', 10000]])
    s.run({ type: 'addText', text: 'hi', startMs: 0, durationMs: 1000 })
    const tid = s.p.text[0].id
    s.run({ type: 'duplicateItem', id: tid })
    expect(s.p.text.map((t) => t.startMs)).toEqual([0, 1000])
  })

  it('trimToPlayhead removes the left or right part', () => {
    const s = setup(); clip(s)
    s.run({ type: 'trimToPlayhead', id: 'c_000001', atMs: 2000, side: 'left' })
    expect(s.p.video[0]).toMatchObject({ startMs: 0, inMs: 2000, outMs: 5000 })
    const t = setup(); clip(t)
    t.run({ type: 'trimToPlayhead', id: 'c_000001', atMs: 2000, side: 'right' })
    expect(t.p.video[0]).toMatchObject({ inMs: 0, outMs: 2000 })
  })

  it('insertFreeze splits the clip and inserts a still', () => {
    const s = setup(); clip(s)
    s.p.media.push({ ...s.p.media[0], id: 'm_still', kind: 'image', durationMs: 0, fps: 0, hasAudio: false })
    s.run({ type: 'insertFreeze', id: 'c_000001', atMs: 2000, mediaId: 'm_still', durationMs: 3000 })
    expect(s.p.video.map((v) => [v.mediaId, v.outMs - v.inMs])).toEqual([['m_a', 2000], ['m_still', 3000], ['m_a', 3000]])
  })

  it('replaceClip keeps place and length', () => {
    const s = setup(); clip(s); clip(s, 'm_b')
    s.p.media.push({ ...s.p.media[0], id: 'm_short', durationMs: 3000 })
    s.run({ type: 'replaceClip', id: 'c_000001', mediaId: 'm_short' })
    expect(s.p.video.map((v) => [v.mediaId, v.inMs, v.outMs, v.startMs])).toEqual([['m_short', 0, 3000, 0], ['m_b', 0, 5000, 3000]])
  })

  it('music overlap is checked per lane, and items without a lane are lane 0', () => {
    const s = setup(); clip(s)
    s.run({ type: 'setMusic', mediaId: 'm_song' })
    s.run({ type: 'extractAudio', id: 'c_000001' })
    expect(s.err({ type: 'moveItem', id: s.p.audio.find((a) => a.lane === 1)!.id, toMs: 0, lane: 0 })).toBe('overlap')
    s.run({ type: 'moveItem', id: s.p.audio.find((a) => a.lane === 1)!.id, toMs: 100, lane: 2 })
    expect(s.p.audio.find((a) => a.mediaId === 'm_a')).toMatchObject({ lane: 2, startMs: 100 })
  })

  it('addAudio places a sound on the chosen lane without touching the music', () => {
    const s = setup()
    s.run({ type: 'setMusic', mediaId: 'm_song' })
    s.run({ type: 'addAudio', mediaId: 'm_song', startMs: 1000, lane: 1 })
    expect(s.p.audio.map((a) => [a.lane, a.startMs, a.outMs])).toEqual([[0, 0, 30000], [1, 1000, 30000]])
    expect(s.err({ type: 'addAudio', mediaId: 'm_song', startMs: 1000, lane: 0 })).toBe('overlap')
  })
})

describe('batch', () => {
  it('applies several edits as one, or none of them if one fails', () => {
    const p = emptyProject('b')
    const r = applyCommand(p, { type: 'batch', summary: 'added 2 captions', commands: [
      { type: 'addText', text: 'a', startMs: 0, durationMs: 500 }, { type: 'addText', text: 'b', startMs: 600, durationMs: 500 }] }, seqIds())
    expect(r.project.text.map((t) => t.text)).toEqual(['a', 'b'])
    expect(r.summary).toBe('added 2 captions')
    expect(r.affected).toHaveLength(2)
    expect(() => applyCommand(r.project, { type: 'batch', commands: [
      { type: 'addText', text: 'c', startMs: 2000, durationMs: 500 }, { type: 'addText', text: 'd', startMs: 100, durationMs: 100 }] }, seqIds())).toThrow(CommandError)
    expect(r.project.text).toHaveLength(2)
  })
})

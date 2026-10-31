import { describe, it, expect } from 'vitest'
import { clipAudioSegments, envelopeAt } from '../../src/shared/clipAudio'
import { emptyProject, type MediaItem, type Project, type VideoItem } from '../../src/shared/model'

const m = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({ id, path: `/v/${id}.mp4`, name: id, folder: '', kind: 'video', createdAt: '', importIndex: 0, durationMs: 10000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'ready', ...over })
function proj(video: Array<Partial<VideoItem>>): Project {
  const p = emptyProject('a')
  p.media = [m('a'), m('b'), m('mute', { hasAudio: false })]
  p.video = video.map((v, i) => ({ id: `c${i}`, mediaId: 'a', startMs: 0, inMs: 2000, outMs: 6000, volume: 1, ...v }))
  return p
}

describe('clip sound', () => {
  it('plain cuts: each clip plays its own sound back to back, no fades', () => {
    const p = proj([{ startMs: 0 }, { startMs: 4000, mediaId: 'b' }])
    expect(clipAudioSegments(p)).toEqual([
      { itemId: 'c0', mediaId: 'a', lane: 0, startMs: 0, inMs: 2000, outMs: 6000, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
      { itemId: 'c1', mediaId: 'b', lane: 1, startMs: 4000, inMs: 2000, outMs: 6000, gain: 1, fadeInMs: 0, fadeOutMs: 0 }
    ])
  })
  it('a transition crossfades the sound over the overlap', () => {
    const p = proj([{ startMs: 0 }, { startMs: 3000, transition: { type: 'fade', durationMs: 1000 } }])
    const [a, b] = clipAudioSegments(p)
    expect(a).toMatchObject({ startMs: 0, outMs: 6000, fadeOutMs: 1000, fadeInMs: 0 })
    expect(b).toMatchObject({ startMs: 3000, inMs: 2000, fadeInMs: 1000 })
  })
  it('an L-cut keeps the first clip sound playing over the next picture; a J-cut starts the next sound early', () => {
    const l = clipAudioSegments(proj([{ startMs: 0 }, { startMs: 4000, audioCutMs: 1500 }]))
    expect(l[0]).toMatchObject({ startMs: 0, inMs: 2000, outMs: 7500 }) // runs 1.5s past its picture
    expect(l[1]).toMatchObject({ startMs: 5500, inMs: 3500, outMs: 6000 }) // starts 1.5s into its picture
    expect(l[0].fadeOutMs).toBeGreaterThan(0); expect(l[1].fadeInMs).toBe(l[0].fadeOutMs) // short crossfade, no click
    const j = clipAudioSegments(proj([{ startMs: 0 }, { startMs: 4000, audioCutMs: -1000 }]))
    expect(j[0]).toMatchObject({ startMs: 0, outMs: 5000 })
    expect(j[1]).toMatchObject({ startMs: 3000, inMs: 1000, outMs: 6000 })
  })
  it('a cut offset never reaches past the source file or the clips; muted and soundless clips are skipped', () => {
    // clip 0 uses source 2000-6000 of a 10s file; an L-cut of 9s is limited by clip 1 (4s long, half = 2s)
    const s = clipAudioSegments(proj([{ startMs: 0 }, { startMs: 4000, audioCutMs: 9000 }]))
    expect(s[0].outMs).toBeLessThanOrEqual(8000)
    expect(s[1].startMs).toBeLessThanOrEqual(6000)
    // J-cut can't start before the source's beginning (clip 1 in at 500)
    const j = clipAudioSegments(proj([{ startMs: 0 }, { startMs: 4000, inMs: 500, outMs: 4500, audioCutMs: -1800 }]))
    expect(j[1].inMs).toBe(0)
    expect(j[1].startMs).toBe(3500)
    expect(clipAudioSegments(proj([{ startMs: 0, volume: 0 }, { startMs: 4000, mediaId: 'mute' }]))).toEqual([])
  })
  it('the envelope ramps linearly in and out', () => {
    const seg = { startMs: 1000, inMs: 0, outMs: 4000, fadeInMs: 1000, fadeOutMs: 500 }
    expect(envelopeAt(seg, 1000)).toBeCloseTo(0)
    expect(envelopeAt(seg, 1500)).toBeCloseTo(0.5)
    expect(envelopeAt(seg, 3000)).toBeCloseTo(1)
    expect(envelopeAt(seg, 4750)).toBeCloseTo(0.5)
    expect(envelopeAt(seg, 5000)).toBeCloseTo(0)
  })
})

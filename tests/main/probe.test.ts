import { describe, it, expect } from 'vitest'
import { probe } from '../../src/main/media/probe'
import { f } from './fixtures'

describe('probe', () => {
  it('reads 4K 120fps HLG HEVC details', async () => {
    const m = await probe(f('day1/hevc_4k120_hlg.mov'))
    expect(m).toMatchObject({ kind: 'video', width: 3840, height: 2160, fps: 120, bitDepth: 10, colorTransfer: 'hlg', hasAudio: true, codec: 'hevc', rotation: 0 })
    expect(m.createdAt).toBe('2026-03-01T10:00:00.000Z')
    expect(m.name).toBe('hevc_4k120_hlg.mov')
    expect(Math.abs(m.durationMs - 5000)).toBeLessThan(50)
  })

  it('handles unicode and quotes in filenames, no audio', async () => {
    const m = await probe(f("day1/Tōkyō day 1 'final'.mov"))
    expect(m.hasAudio).toBe(false)
    expect(m.colorTransfer).toBe('sdr')
    expect(m.fps).toBe(30)
  })

  it('reports rotated dimensions for portrait phone clips', async () => {
    const m = await probe(f('day2/portrait_rot90.mp4'))
    expect([m.width, m.height, m.rotation]).toEqual([1080, 1920, 90])
  })

  it('treats mp3 as audio', async () => {
    const m = await probe(f('music/track_02.mp3'))
    expect(m.kind).toBe('audio')
    expect([m.width, m.height]).toEqual([0, 0])
    expect(Math.abs(m.durationMs - 30000)).toBeLessThanOrEqual(50)
  })

  it('rejects a missing file with a readable error', async () => {
    await expect(probe(f('nope.mov'))).rejects.toThrow(/nope\.mov/)
  })
})

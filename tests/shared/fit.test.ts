import { describe, it, expect } from 'vitest'
import { coverRect } from '../../src/renderer/preview/fit'

describe('coverRect', () => {
  it('center-crops 16:9 4K into a 9:16 frame', () => {
    expect(coverRect(3840, 2160, 1080, 1920)).toEqual({ sx: 1312.5, sy: 0, sw: 1215, sh: 2160 })
  })
  it('is identity when aspects match', () => {
    expect(coverRect(1920, 1080, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 })
  })
  it('crops top and bottom for a portrait source in a 16:9 frame', () => {
    expect(coverRect(1080, 1920, 1920, 1080)).toEqual({ sx: 0, sy: 656.25, sw: 1080, sh: 607.5 })
  })
})

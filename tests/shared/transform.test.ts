import { describe, it, expect } from 'vitest'
import { IDENTITY_TRANSFORM, type ClipTransform } from '@shared/model'
import { applyMat3, orientedSize, transformFilters, uvMatrix } from '@shared/transform'

const T = (over: Partial<ClipTransform>): ClipTransform => ({ ...IDENTITY_TRANSFORM, ...over })
const at = (m: number[], x: number, y: number): [number, number] => { const [u, v] = applyMat3(m, x, y); return [Math.round(u * 10000) / 10000, Math.round(v * 10000) / 10000] }

describe('clip transform maths', () => {
  it('identity cover of 16:9 into 9:16 takes the centre strip', () => {
    const m = uvMatrix(1920, 1080, IDENTITY_TRANSFORM, 1080, 1920)
    expect(at(m, 0, 0)).toEqual([0.3418, 0])
    expect(at(m, 1, 1)).toEqual([0.6582, 1])
  })
  it('rotate 90 clockwise: the output top-left shows the source bottom-left', () => {
    const m = uvMatrix(1000, 1000, T({ rotate: 90 }), 100, 100)
    expect(at(m, 0, 0)).toEqual([0, 1])
    expect(at(m, 1, 0)).toEqual([0, 0])
    expect(at(m, 0, 1)).toEqual([1, 1])
  })
  it('rotate 270 and 180', () => {
    expect(at(uvMatrix(1000, 1000, T({ rotate: 270 }), 100, 100), 0, 0)).toEqual([1, 0])
    expect(at(uvMatrix(1000, 1000, T({ rotate: 180 }), 100, 100), 0, 0)).toEqual([1, 1])
  })
  it('flipH mirrors left and right after rotating', () => {
    const m = uvMatrix(1000, 1000, T({ flipH: true }), 100, 100)
    expect(at(m, 0, 0)).toEqual([1, 0])
    const r = uvMatrix(1000, 1000, T({ rotate: 90, flipH: true }), 100, 100)
    expect(at(r, 0, 0)).toEqual([0, 0]) // mirror of the rotated top-right
  })
  it('crop maps the output onto the cropped part', () => {
    const m = uvMatrix(1000, 1000, T({ crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }), 50, 100)
    expect(at(m, 0, 0)).toEqual([0.5, 0])
    expect(at(m, 1, 1)).toEqual([1, 1])
  })
  it('oriented size swaps for quarter turns and shrinks for crops', () => {
    expect(orientedSize(1920, 1080, T({ rotate: 90 }))).toEqual({ w: 1080, h: 1920 })
    expect(orientedSize(1920, 1080, T({ crop: { x: 0, y: 0, w: 0.5, h: 1 } }))).toEqual({ w: 960, h: 1080 })
  })
  it('ffmpeg filters run in the same order: crop, rotate, flip', () => {
    expect(transformFilters(T({ rotate: 90, flipH: true, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }))).toEqual(['crop=iw*0.5:ih*1:iw*0.25:ih*0', 'transpose=1', 'hflip'])
    expect(transformFilters(T({ rotate: 180 }))).toEqual(['hflip', 'vflip'])
    expect(transformFilters(T({ rotate: 270, flipV: true }))).toEqual(['transpose=2', 'vflip'])
    expect(transformFilters(IDENTITY_TRANSFORM)).toEqual([])
  })
})

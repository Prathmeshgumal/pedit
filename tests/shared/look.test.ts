import { describe, it, expect } from 'vitest'
import { adjustColor, buildLut, parseCube, toCube, sampleLut, lookKey, LUT_SIZE, type Adjust } from '../../src/shared/look'

const close = (a: number[], b: number[], eps = 0.01): void => a.forEach((x, i) => expect(Math.abs(x - b[i]), `channel ${i}: ${x} vs ${b[i]}`).toBeLessThan(eps))

describe('colour adjustments', () => {
  it('no adjustment leaves colours alone', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]]) close(adjustColor(c as [number, number, number], {}), c)
  })
  it('saturation -100 makes grey, +100 makes colours stronger', () => {
    const g = adjustColor([0.8, 0.3, 0.2], { saturation: -100 })
    expect(Math.abs(g[0] - g[1]) + Math.abs(g[1] - g[2])).toBeLessThan(0.01)
    const v = adjustColor([0.6, 0.4, 0.4], { saturation: 100 })
    expect(v[0] - v[1]).toBeGreaterThan(0.2)
  })
  it('temperature warms (more red, less blue) and cools', () => {
    const w = adjustColor([0.5, 0.5, 0.5], { temperature: 60 })
    expect(w[0]).toBeGreaterThan(0.53); expect(w[2]).toBeLessThan(0.47)
    const c = adjustColor([0.5, 0.5, 0.5], { temperature: -60 })
    expect(c[2]).toBeGreaterThan(c[0])
  })
  it('brightness and exposure brighten, contrast spreads tones around the middle', () => {
    expect(adjustColor([0.4, 0.4, 0.4], { brightness: 50 })[0]).toBeGreaterThan(0.45)
    expect(adjustColor([0.4, 0.4, 0.4], { exposure: 50 })[0]).toBeGreaterThan(0.45)
    const hi = adjustColor([0.7, 0.7, 0.7], { contrast: 60 }), lo = adjustColor([0.3, 0.3, 0.3], { contrast: 60 })
    expect(hi[0]).toBeGreaterThan(0.72); expect(lo[0]).toBeLessThan(0.28)
  })
  it('shadows lifts dark tones more than bright ones; highlights pulls down bright ones; fade lifts black', () => {
    const d = adjustColor([0.1, 0.1, 0.1], { shadows: 60 })[0] - 0.1, b = adjustColor([0.9, 0.9, 0.9], { shadows: 60 })[0] - 0.9
    expect(d).toBeGreaterThan(0.03); expect(Math.abs(b)).toBeLessThan(d / 3)
    expect(adjustColor([0.9, 0.9, 0.9], { highlights: -60 })[0]).toBeLessThan(0.87)
    expect(adjustColor([0, 0, 0], { fade: 50 })[0]).toBeGreaterThan(0.05)
  })
  it('results always stay in range', () => {
    const extreme: Adjust = { brightness: 100, contrast: 100, saturation: 100, exposure: 100, temperature: 100, tint: 100, highlights: 100, shadows: 100, fade: 100, vibrance: 100 }
    for (const c of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0.5, 0.2, 0.9]]) for (const v of adjustColor(c as [number, number, number], extreme)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
})

describe('3D LUTs', () => {
  it('an identity look gives an identity LUT, and sampling it returns the input', () => {
    const lut = buildLut({})
    expect(lut.length).toBe(LUT_SIZE ** 3 * 3)
    close(sampleLut(lut, [0.25, 0.6, 0.9]), [0.25, 0.6, 0.9], 0.005)
  })
  it('a filter at half strength sits halfway between the original and the full filter', () => {
    const full = buildLut({ filter: { name: 'bw', strength: 1, adjust: { saturation: -100 } } })
    const half = buildLut({ filter: { name: 'bw', strength: 0.5, adjust: { saturation: -100 } } })
    const c: [number, number, number] = [0.8, 0.3, 0.2]
    const f = sampleLut(full, c), h = sampleLut(half, c)
    close(h, c.map((x, i) => (x + f[i]) / 2), 0.01)
  })
  it('the clip adjustments apply after the filter', () => {
    const lut = buildLut({ filter: { name: 'bw', strength: 1, adjust: { saturation: -100 } }, adjust: { temperature: 80 } })
    const out = sampleLut(lut, [0.5, 0.5, 0.5])
    expect(out[0]).toBeGreaterThan(out[2] + 0.05) // warmed grey
  })
  it('reads and writes .cube files (including a LUT file inside a filter)', () => {
    const lut = buildLut({ adjust: { saturation: -40, contrast: 20 } })
    const text = toCube(lut, 'test')
    expect(text).toContain('LUT_3D_SIZE 33')
    const back = parseCube(text)
    expect(back.size).toBe(33)
    close(sampleLut(back.data, [0.3, 0.5, 0.7], back.size), sampleLut(lut, [0.3, 0.5, 0.7]), 0.002)
    // a tiny 2-point cube that inverts colours, used as a filter's LUT
    const invert = parseCube('TITLE "inv"\nLUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n')
    const viaFilter = buildLut({ filter: { name: 'inv', strength: 1, adjust: {}, lut: 'x.cube' } }, { 'x.cube': invert })
    close(sampleLut(viaFilter, [0.2, 0.4, 0.9]), [0.8, 0.6, 0.1], 0.01)
    expect(() => parseCube('LUT_3D_SIZE 2\n1 1 1\n')).toThrow(/expected 8/)
  })
  it('the look key changes when anything that affects colour changes', () => {
    expect(lookKey({})).toBe(lookKey({ adjust: {} }))
    expect(lookKey({ adjust: { saturation: 10 } })).not.toBe(lookKey({ adjust: { saturation: 11 } }))
  })
})

import { describe, it, expect } from 'vitest'
import { textAnimAt, ffTextAnim, animWindowMs } from '../../src/shared/textAnim'
import { DEFAULT_TEXT_STYLE, type TextItem } from '../../src/shared/model'

const item = (style: Partial<TextItem['style']>, startMs = 1000, durationMs = 3000): TextItem =>
  ({ id: 't_1', startMs, durationMs, text: 'Hi', style: { ...DEFAULT_TEXT_STYLE, ...style } })

/** Evaluate the small subset of ffmpeg expression syntax ffTextAnim emits, at time t (seconds). */
function ffEval(expr: string, t: number): number {
  const clip = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
  return Function('t', 'clip', 'pow', `return ${expr}`)(t, clip, Math.pow) as number
}

describe('text animations', () => {
  it('no animation: fully shown, no movement', () => {
    expect(textAnimAt(item({}), 1000)).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1 })
  })
  it('fade in and out ramp the opacity linearly over the animation length', () => {
    const it = item({ animIn: 'fade', animOut: 'fade', animMs: 500 })
    expect(textAnimAt(it, 1000).alpha).toBeCloseTo(0)
    expect(textAnimAt(it, 1250).alpha).toBeCloseTo(0.5)
    expect(textAnimAt(it, 2000).alpha).toBeCloseTo(1)
    expect(textAnimAt(it, 3750).alpha).toBeCloseTo(0.5)
  })
  it('slide-up starts below and eases into place', () => {
    const it = item({ animIn: 'slide-up', animMs: 400 })
    const a = textAnimAt(it, 1000), b = textAnimAt(it, 1200), c = textAnimAt(it, 1400)
    expect(a.dy).toBeGreaterThan(0)
    expect(b.dy).toBeGreaterThan(0)
    expect(b.dy).toBeLessThan(a.dy / 2) // ease-out: more than half the way at half time
    expect(c.dy).toBeCloseTo(0)
    expect(textAnimAt(item({ animOut: 'slide-left' }), 3999).dx).toBeLessThan(0)
  })
  it('pop grows from smaller to full size', () => {
    const it = item({ animIn: 'pop', animMs: 400 })
    expect(textAnimAt(it, 1000).scale).toBeLessThan(0.7)
    expect(textAnimAt(it, 1400).scale).toBeCloseTo(1)
  })
  it('a short text never animates for more than half its length', () => {
    expect(animWindowMs(item({ animIn: 'fade', animMs: 1000 }, 0, 600))).toBe(300)
  })
  it('the export expressions give the same motion as the preview', () => {
    for (const anim of ['slide-up', 'slide-down', 'slide-left', 'slide-right', 'pop'] as const) {
      const it = item({ animIn: anim, animOut: anim, animMs: 500 })
      const ff = ffTextAnim(it, 1920, 1080, { cx: 900, cy: 500 })
      for (const ms of [1000, 1100, 1300, 1500, 2500, 3600, 3900]) {
        const s = textAnimAt(it, ms)
        const x = ffEval(ff.x, ms / 1000), y = ffEval(ff.y, ms / 1000)
        const expX = s.dx * 1920 + 900 * (1 - s.scale), expY = s.dy * 1080 + 500 * (1 - s.scale)
        expect(Math.abs(x - expX), `${anim} x at ${ms}`).toBeLessThan(1)
        expect(Math.abs(y - expY), `${anim} y at ${ms}`).toBeLessThan(1)
        if (ff.scale) expect(ffEval(ff.scale, ms / 1000)).toBeCloseTo(s.scale, 5)
      }
    }
    const fade = ffTextAnim(item({ animIn: 'fade', animOut: 'fade', animMs: 500 }), 1920, 1080, { cx: 0, cy: 0 })
    expect(fade.fades).toEqual(['fade=t=in:st=1:d=0.5:alpha=1', 'fade=t=out:st=3.5:d=0.5:alpha=1'])
    expect(ffTextAnim(item({}), 1920, 1080, { cx: 0, cy: 0 })).toEqual({ x: '0', y: '0', scale: null, fades: [] })
  })
})

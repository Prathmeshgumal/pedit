import type { TextItem } from './model'

/** Opacity, shift (fractions of the frame) and scale (around the text centre) of a text at one moment. */
export interface AnimState { alpha: number; dx: number; dy: number; scale: number }

/** How far slides travel, as a fraction of the frame. */
export const SLIDE = 0.08
const POP_FROM = 0.5

export const animWindowMs = (t: TextItem): number => Math.min(t.style.animMs ?? 400, t.durationMs / 2)

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const SHIFT: Record<string, [number, number]> = { 'slide-up': [0, 1], 'slide-down': [0, -1], 'slide-left': [1, 0], 'slide-right': [-1, 0] }

/** Preview side. Opacity ramps linearly (so ffmpeg's fade filter matches); motion eases out (cubic). */
export function textAnimAt(t: TextItem, ms: number): AnimState {
  const d = animWindowMs(t)
  const s: AnimState = { alpha: 1, dx: 0, dy: 0, scale: 1 }
  const apply = (anim: string | undefined, p: number, sign: number): void => {
    if (!anim || anim === 'none' || d <= 0) return
    s.alpha *= p
    const left = Math.pow(1 - p, 3) // 1 → 0 as the animation completes
    const sh = SHIFT[anim]
    if (sh) { s.dx += sign * sh[0] * SLIDE * left; s.dy += sign * sh[1] * SLIDE * left }
    if (anim === 'pop') s.scale *= POP_FROM + (1 - POP_FROM) * (1 - left)
  }
  apply(t.style.animIn, clamp01((ms - t.startMs) / d), 1)
  // going out mirrors coming in: slide-up leaves upwards
  apply(t.style.animOut, clamp01((t.startMs + t.durationMs - ms) / d), -1)
  return s
}

const n = (x: number): string => String(Math.round(x * 1e6) / 1e6)

/**
 * Export side: overlay x/y expressions (top-left of the full-frame text image, in t seconds),
 * an optional scale expression for the image and the alpha fades, matching textAnimAt.
 */
export function ffTextAnim(t: TextItem, W: number, H: number, centre: { cx: number; cy: number }): { x: string; y: string; scale: string | null; fades: string[] } {
  const d = animWindowMs(t) / 1000
  const st = t.startMs / 1000, en = (t.startMs + t.durationMs) / 1000
  const xs: string[] = [], ys: string[] = [], scales: string[] = [], fades: string[] = []
  const add = (anim: string | undefined, p: string, sign: number, dir: 'in' | 'out'): void => {
    if (!anim || anim === 'none' || d <= 0) return
    fades.push(`fade=t=${dir}:st=${n(dir === 'in' ? st : en - d)}:d=${n(d)}:alpha=1`)
    const left = `pow(1-${p},3)`
    const sh = SHIFT[anim]
    if (sh?.[0]) xs.push(`${n(sign * sh[0] * SLIDE * W)}*${left}`)
    if (sh?.[1]) ys.push(`${n(sign * sh[1] * SLIDE * H)}*${left}`)
    if (anim === 'pop') scales.push(`(${n(POP_FROM)}+${n(1 - POP_FROM)}*(1-${left}))`)
  }
  add(t.style.animIn, `clip((t-${n(st)})/${n(d)},0,1)`, 1, 'in')
  add(t.style.animOut, `clip((${n(en)}-t)/${n(d)},0,1)`, -1, 'out')
  const scale = scales.length ? scales.join('*') : null
  if (scale) { xs.push(`${n(centre.cx)}*(1-${scale})`); ys.push(`${n(centre.cy)}*(1-${scale})`) }
  return { x: xs.join('+') || '0', y: ys.join('+') || '0', scale, fades }
}

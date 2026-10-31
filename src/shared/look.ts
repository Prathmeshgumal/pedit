/**
 * Colour looks: filters (named presets, optionally with a .cube LUT) and per-clip adjustments.
 * Everything that changes colour per pixel is baked into one 3D LUT, used by the preview (WebGL 3D texture)
 * and the export (ffmpeg lut3d), so both look the same. Vignette depends on position, so it is separate.
 */

/** Each value is -100..100 (0 = unchanged), except hues (degrees), tones and vignette (0..100). */
export interface Adjust {
  exposure?: number
  brightness?: number
  contrast?: number
  highlights?: number
  shadows?: number
  saturation?: number
  /** Saturation that spares already-strong colours (skin stays natural). */
  vibrance?: number
  /** + warmer (orange), − cooler (blue) */
  temperature?: number
  /** + magenta, − green */
  tint?: number
  /** Lifts the blacks for a matte, filmic look (0..100). */
  fade?: number
  /** Split toning: colour pushed into the dark / bright parts. */
  shadowHue?: number
  shadowTone?: number
  highlightHue?: number
  highlightTone?: number
  /** Darkens the edges (0..100). */
  vignette?: number
}

export const ADJUST_KEYS = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'temperature', 'tint', 'fade',
  'shadowHue', 'shadowTone', 'highlightHue', 'highlightTone', 'vignette'] as const satisfies ReadonlyArray<keyof Adjust>

export interface FilterRef { name: string; strength: number; adjust: Adjust; lut?: string }
/** What a clip carries: a copy of its filter's settings (so the project still looks right without the library) plus its own adjustments. */
export interface ClipLook { filter?: FilterRef | null; adjust?: Adjust }

export type RGB = [number, number, number]
export const LUT_SIZE = 33
export interface Cube { size: number; data: Float32Array }

const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

function hueRgb(deg: number): RGB {
  const h = (((deg % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  return [r, g, b]
}

/** The adjustments applied to one colour (0..1 sRGB values). Vignette is not part of this. */
export function adjustColor(input: RGB, a: Adjust): RGB {
  let c: RGB = [...input]
  const v = (k: keyof Adjust): number => (a[k] ?? 0) / 100
  if (a.exposure) { const m = Math.pow(2, v('exposure') * 1.2); c = c.map((x) => x * m) as RGB }
  if (a.brightness) { const b = v('brightness') * 0.25; c = c.map((x) => x + b * (1 - Math.abs(x - 0.5))) as RGB }
  if (a.temperature) { const t = v('temperature') * 0.1; c = [c[0] + t, c[1] + t * 0.15, c[2] - t] }
  if (a.tint) { const t = v('tint') * 0.08; c = [c[0] + t * 0.5, c[1] - t, c[2] + t * 0.5] }
  if (a.contrast) { const k = 1 + v('contrast') * 0.8; c = c.map((x) => (x - 0.5) * k + 0.5) as RGB }
  if (a.shadows || a.highlights) {
    const L = clamp(luma(c))
    const d = v('shadows') * 0.25 * (1 - L) * (1 - L) + v('highlights') * 0.25 * L * L
    c = c.map((x) => x + d) as RGB
  }
  if (a.shadowTone || a.highlightTone) {
    const L = clamp(luma(c))
    const sh = hueRgb(a.shadowHue ?? 200), hi = hueRgb(a.highlightHue ?? 35)
    const ws = v('shadowTone') * 0.2 * (1 - L) * (1 - L), wh = v('highlightTone') * 0.2 * L * L
    c = c.map((x, i) => x + (sh[i] - 0.5) * ws + (hi[i] - 0.5) * wh) as RGB
  }
  if (a.saturation || a.vibrance) {
    const L = luma(c)
    const sat = Math.max(...c) - Math.min(...c)
    const k = 1 + v('saturation') + v('vibrance') * (1 - Math.min(1, sat * 1.5))
    c = c.map((x) => L + (x - L) * Math.max(0, k)) as RGB
  }
  if (a.fade) { const f = Math.max(0, v('fade')); c = c.map((x) => x * (1 - f * 0.25) + f * 0.12) as RGB }
  return c.map(clamp) as RGB
}

/** Trilinear lookup into a LUT (.cube order: red changes fastest). */
export function sampleLut(data: Float32Array, c: RGB, size = LUT_SIZE): RGB {
  const n = size - 1
  const p = c.map((x) => clamp(x) * n)
  const i0 = p.map((x) => Math.min(n - 1, Math.floor(x))), f = p.map((x, k) => x - i0[k])
  const at = (r: number, g: number, b: number, ch: number): number => data[((b * size + g) * size + r) * 3 + ch]
  const out: RGB = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) {
    let s = 0
    for (let dr = 0; dr < 2; dr++) for (let dg = 0; dg < 2; dg++) for (let db = 0; db < 2; db++) {
      const w = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2])
      if (w) s += w * at(i0[0] + dr, i0[1] + dg, i0[2] + db, ch)
    }
    out[ch] = s
  }
  return out
}

/** One LUT for a clip: its filter (LUT file, then the filter's adjustments) blended by strength, then the clip's own adjustments. */
export function buildLut(look: ClipLook, cubes: Record<string, Cube> = {}, size = LUT_SIZE): Float32Array {
  const out = new Float32Array(size ** 3 * 3)
  const f = look.filter
  const fc = f?.lut ? cubes[f.lut] : undefined
  const s = f ? Math.min(1, Math.max(0, f.strength)) : 0
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const c: RGB = [r / (size - 1), g / (size - 1), b / (size - 1)]
    let x = c
    if (f && s > 0) {
      let y = fc ? sampleLut(fc.data, c, fc.size) : c
      y = adjustColor(y, f.adjust ?? {})
      x = [c[0] + (y[0] - c[0]) * s, c[1] + (y[1] - c[1]) * s, c[2] + (y[2] - c[2]) * s]
    }
    if (look.adjust) x = adjustColor(x, look.adjust)
    out.set(x, ((b * size + g) * size + r) * 3)
  }
  return out
}

/** Edge darkening for a clip (0..1): the filter's (scaled by strength) plus the clip's own. */
export function vignetteOf(look: ClipLook | undefined): number {
  if (!look) return 0
  const fv = (look.filter?.adjust.vignette ?? 0) * Math.min(1, Math.max(0, look.filter?.strength ?? 0))
  return Math.min(1, Math.max(0, (fv + (look.adjust?.vignette ?? 0)) / 100))
}

/** Vignette as ffmpeg's vignette filter defines it (cos⁴ falloff to the corners); angle from strength. Preview uses the same formula. */
export const vignetteAngle = (v: number): number => v * 1.1

/** True when the look changes nothing (no LUT needed). */
export function isNeutral(look: ClipLook | undefined): boolean {
  if (!look) return true
  const empty = (a?: Adjust): boolean => !a || ADJUST_KEYS.every((k) => k === 'vignette' || k === 'shadowHue' || k === 'highlightHue' || !a[k])
  return (!look.filter || look.filter.strength <= 0 || (empty(look.filter.adjust) && !look.filter.lut)) && empty(look.adjust)
}

/** Stable key of everything that affects the LUT. */
export function lookKey(look: ClipLook | undefined): string {
  const norm = (a?: Adjust): Record<string, number> => Object.fromEntries(ADJUST_KEYS.filter((k) => k !== 'vignette' && a?.[k]).map((k) => [k, a![k]!]))
  if (!look || isNeutral(look)) return 'none'
  const f = look.filter && look.filter.strength > 0 ? { s: look.filter.strength, a: norm(look.filter.adjust), l: look.filter.lut ?? null } : null
  return JSON.stringify({ f, a: norm(look.adjust) })
}

export function parseCube(text: string): Cube {
  let size = 0
  const vals: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || /^(TITLE|DOMAIN_MIN|DOMAIN_MAX|LUT_1D_SIZE)\b/.test(line)) {
      if (line.startsWith('LUT_1D_SIZE')) throw new Error('1D LUTs are not supported; use a 3D .cube')
      continue
    }
    const m = /^LUT_3D_SIZE\s+(\d+)/.exec(line)
    if (m) { size = Number(m[1]); continue }
    const parts = line.split(/\s+/).map(Number)
    if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) vals.push(...parts)
  }
  if (size < 2 || size > 128) throw new Error('not a 3D .cube LUT (no LUT_3D_SIZE)')
  if (vals.length !== size ** 3 * 3) throw new Error(`bad .cube: expected ${size ** 3} rows, got ${vals.length / 3}`)
  return { size, data: Float32Array.from(vals) }
}

export function toCube(data: Float32Array, title = 'pedit', size = LUT_SIZE): string {
  const rows: string[] = [`TITLE "${title.replace(/"/g, '')}"`, `LUT_3D_SIZE ${size}`]
  for (let i = 0; i < data.length; i += 3) rows.push(`${data[i].toFixed(6)} ${data[i + 1].toFixed(6)} ${data[i + 2].toFixed(6)}`)
  return rows.join('\n') + '\n'
}

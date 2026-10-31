import type { ClipTransform } from './model'

/** Source rectangle that center-crops (srcW×srcH) to fill a dstW×dstH frame. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): { sx: number; sy: number; sw: number; sh: number } {
  const dst = dstW / dstH
  const src = srcW / srcH
  if (src > dst) {
    const sw = srcH * dst
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH }
  }
  const sh = srcW / dst
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh }
}

/** Size of the picture after crop and rotation, before it is fitted to the frame. */
export function orientedSize(w: number, h: number, t: ClipTransform): { w: number; h: number } {
  const cw = Math.round(w * t.crop.w), ch = Math.round(h * t.crop.h)
  return t.rotate === 90 || t.rotate === 270 ? { w: ch, h: cw } : { w: cw, h: ch }
}

// 3x3 matrices, row-major [a b c; d e f; 0 0 1] as 9 numbers
type M = number[]
const mul = (a: M, b: M): M => {
  const r = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}
const affine = (a: number, b: number, c: number, d: number, e: number, f: number): M => [a, b, c, d, e, f, 0, 0, 1]

/** Apply a column-major mat3 (as returned by uvMatrix) to (x, y). */
export function applyMat3(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[3] * y + m[6], m[1] * x + m[4] * y + m[7]]
}

/**
 * Column-major mat3 for WebGL: output quad coords q ∈ [0,1]² (y down) → source texture uv.
 * Order (same as export): crop → rotate clockwise → flip → cover-fit into dstW×dstH.
 */
export function uvMatrix(srcW: number, srcH: number, t: ClipTransform, dstW: number, dstH: number): number[] {
  const o = orientedSize(srcW, srcH, t)
  const r = coverRect(o.w, o.h, dstW, dstH)
  // q → oriented normalized
  let m = affine(r.sw / o.w, 0, r.sx / o.w, 0, r.sh / o.h, r.sy / o.h)
  // undo flips (in oriented space)
  if (t.flipH) m = mul(affine(-1, 0, 1, 0, 1, 0), m)
  if (t.flipV) m = mul(affine(1, 0, 0, 0, -1, 1), m)
  // oriented → cropped (inverse of the clockwise rotation)
  const unrot = t.rotate === 90 ? affine(0, 1, 0, -1, 0, 1) : t.rotate === 180 ? affine(-1, 0, 1, 0, -1, 1) : t.rotate === 270 ? affine(0, -1, 1, 1, 0, 0) : affine(1, 0, 0, 0, 1, 0)
  m = mul(unrot, m)
  // cropped → source uv
  m = mul(affine(t.crop.w, 0, t.crop.x, 0, t.crop.h, t.crop.y), m)
  return [m[0], m[3], 0, m[1], m[4], 0, m[2], m[5], 1]
}

/** The same transform as ffmpeg filters, applied to the upright source before the cover scale. */
export function transformFilters(t: ClipTransform): string[] {
  const f: string[] = []
  const c = t.crop
  if (c.x || c.y || c.w < 1 || c.h < 1) f.push(`crop=iw*${c.w}:ih*${c.h}:iw*${c.x}:ih*${c.y}`)
  if (t.rotate === 90) f.push('transpose=1')
  else if (t.rotate === 180) f.push('hflip', 'vflip')
  else if (t.rotate === 270) f.push('transpose=2')
  if (t.flipH) f.push('hflip')
  if (t.flipV) f.push('vflip')
  return f
}

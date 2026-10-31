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

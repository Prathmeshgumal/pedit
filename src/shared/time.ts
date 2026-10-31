/** 3000 -> "0:03.0", 83450 -> "1:23.4" (tenths, truncated) */
export function fmtTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const m = Math.floor(tenths / 600)
  const s = (tenths % 600) / 10
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

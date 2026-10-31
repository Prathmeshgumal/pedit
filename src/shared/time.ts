/** 3000 -> "0:03.0", 83450 -> "1:23.4" (tenths, truncated) */
export function fmtTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const m = Math.floor(tenths / 600)
  const s = (tenths % 600) / 10
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** 3500ms at 30fps -> "00:00:03:15" (hours:minutes:seconds:frames, CapCut style). */
export function fmtTimecode(ms: number, fps: number): string {
  const r = Math.max(1, Math.round(fps))
  const frames = Math.floor((Math.max(0, ms) * r) / 1000 + 1e-6)
  const ff = frames % r, total = Math.floor(frames / r)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(Math.floor(total / 3600))}:${p(Math.floor(total / 60) % 60)}:${p(total % 60)}:${p(ff)}`
}

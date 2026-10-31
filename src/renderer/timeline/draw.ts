import type { MediaItem, Project } from '@shared/model'
import type { DraftDiff } from '@shared/session'
import { mediaUrl } from '@shared/mediaUrl'
import { MAX_FILMSTRIP_FRAMES } from './constants'
import { CONTENT_H, HEADER_W, RULER_H, TRACKS, layoutTimeline, msToX, type LaidOut, type Track } from './layout'

const COLORS: Record<Track, string> = { video: '#2f6db5', text: '#b5822f', audio: '#2e8b57' }

const images = new Map<string, HTMLImageElement>()
const peaks = new Map<string, Float32Array | 'loading'>()

function image(path: string, onLoad: () => void): HTMLImageElement | null {
  let img = images.get(path)
  if (!img) {
    img = new Image()
    img.onload = onLoad
    img.src = mediaUrl(path)
    images.set(path, img)
  }
  return img.complete && img.naturalWidth ? img : null
}

function waveform(path: string, onLoad: () => void): Float32Array | null {
  const w = peaks.get(path)
  if (w === 'loading') return null
  if (w) return w
  peaks.set(path, 'loading')
  void fetch(mediaUrl(path)).then((r) => r.arrayBuffer()).then((b) => { peaks.set(path, new Float32Array(b)); onLoad() }, () => peaks.delete(path))
  return null
}

export interface DrawState {
  project: Project
  real: Project | null
  diff: DraftDiff | null
  pxPerMs: number
  scrollMs: number
  selected: string | null
  ghost: { id: string; dxMs: number; trim?: 'left-edge' | 'right-edge' } | null
  dropHint: { track: Track; ms: number } | null
}

function tickStep(pxPerMs: number): number {
  for (const s of [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000]) if (s * pxPerMs >= 70) return s
  return 1200000
}

export function rulerLabel(ms: number): string {
  const tenths = Math.round(ms / 100)
  const m = Math.floor(tenths / 600)
  const r = tenths - m * 600
  const whole = String(Math.floor(r / 10)).padStart(2, '0')
  return r % 10 ? `${m}:${whole}.${r % 10}` : `${m}:${whole}`
}

function stripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  ctx.fillStyle = 'rgba(124,77,255,0.45)'
  for (let i = -h; i < w; i += 10) {
    ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + 5, y + h); ctx.lineTo(x + i + 5 + h, y); ctx.lineTo(x + i + h, y); ctx.fill()
  }
  ctx.restore()
}

export function drawTimeline(ctx: CanvasRenderingContext2D, w: number, s: DrawState, redraw: () => void): LaidOut[] {
  const p = s.project
  ctx.clearRect(0, 0, w, CONTENT_H)
  ctx.fillStyle = '#1a1a1e'; ctx.fillRect(0, 0, w, CONTENT_H)
  // ruler
  ctx.fillStyle = '#232328'; ctx.fillRect(0, 0, w, RULER_H)
  ctx.font = '10px Inter, system-ui'; ctx.fillStyle = '#80808a'; ctx.strokeStyle = '#3a3a42'
  const step = tickStep(s.pxPerMs)
  const first = Math.max(0, Math.floor(s.scrollMs / step) * step)
  for (let t = first; msToX(t, s.pxPerMs, s.scrollMs) < w; t += step) {
    const x = Math.round(msToX(t, s.pxPerMs, s.scrollMs)) + 0.5
    if (x < HEADER_W) continue
    ctx.beginPath(); ctx.moveTo(x, RULER_H - 7); ctx.lineTo(x, RULER_H); ctx.stroke()
    ctx.fillText(rulerLabel(t), x + 3, 12)
  }
  // track backgrounds + labels
  for (const [name, t] of Object.entries(TRACKS) as Array<[Track, (typeof TRACKS)[Track]]>) {
    ctx.fillStyle = '#222227'; ctx.fillRect(HEADER_W, RULER_H + t.y, w - HEADER_W, t.h)
    ctx.fillStyle = '#6b6b75'; ctx.fillText(t.label, 8, RULER_H + t.y + t.h / 2 + 3)
    if (s.dropHint?.track === name) { ctx.fillStyle = 'rgba(56,189,248,0.12)'; ctx.fillRect(HEADER_W, RULER_H + t.y, w - HEADER_W, t.h) }
  }
  const media = new Map<string, MediaItem>(p.media.map((m) => [m.id, m]))
  const layout = layoutTimeline(p, s.pxPerMs, s.scrollMs)
  ctx.save(); ctx.beginPath(); ctx.rect(HEADER_W, 0, w - HEADER_W, CONTENT_H); ctx.clip()

  // removed-in-draft items, drawn at their real position
  if (s.real && s.diff?.removed.length) {
    for (const it of layoutTimeline(s.real, s.pxPerMs, s.scrollMs).filter((i) => s.diff!.removed.includes(i.id))) {
      const t = TRACKS[it.track]; const y = RULER_H + t.y
      ctx.fillStyle = 'rgba(90,42,42,0.6)'; ctx.fillRect(it.x, y + 2, it.w, t.h - 4)
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#ff6b6b'; ctx.strokeRect(it.x + 0.5, y + 2.5, it.w - 1, t.h - 5); ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(it.x, y + t.h / 2); ctx.lineTo(it.x + it.w, y + t.h / 2); ctx.stroke()
    }
  }

  for (const it of layout) {
    const t = TRACKS[it.track]
    let { x, w: iw } = it
    if (s.ghost?.id === it.id) {
      const dx = s.ghost.dxMs * s.pxPerMs
      if (!s.ghost.trim) x += dx
      else if (s.ghost.trim === 'left-edge') { x += dx; iw -= dx } else iw += dx
      ctx.globalAlpha = 0.75
    }
    const y = RULER_H + t.y + 2
    const h = t.h - 4
    if (x + iw < HEADER_W || x > w) { ctx.globalAlpha = 1; continue }
    ctx.fillStyle = COLORS[it.track]
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(1, iw - 1), h, 3); ctx.fill()
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, Math.max(1, iw - 1), h, 3); ctx.clip()
    if (it.track === 'video') {
      const v = p.video.find((i) => i.id === it.id)!
      const m = media.get(v.mediaId)
      const img = m?.filmstripPath ? image(m.filmstripPath, redraw) : null
      if (img && m) {
        const frames = Math.min(MAX_FILMSTRIP_FRAMES, Math.ceil(Math.max(1, m.durationMs / 1000)))
        const fw = img.naturalWidth / frames
        const tw = (h / img.naturalHeight) * fw
        for (let tx = x; tx < x + iw; tx += tw) {
          const srcMs = v.inMs + (tx - x) / s.pxPerMs
          const fi = Math.min(frames - 1, Math.floor((srcMs / m.durationMs) * frames))
          ctx.drawImage(img, fi * fw, 0, fw, img.naturalHeight, tx, y, tw, h)
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, y, iw, 14)
      ctx.fillStyle = '#fff'; ctx.fillText(m?.name ?? '?', x + 4, y + 10)
    } else if (it.track === 'audio') {
      const a = p.audio.find((i) => i.id === it.id)!
      const m = media.get(a.mediaId)
      const pk = m?.waveformPath ? waveform(m.waveformPath, redraw) : null
      if (pk) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        for (let px = Math.max(x, HEADER_W); px < Math.min(x + iw, w); px += 2) {
          const ms = a.inMs + (px - x) / s.pxPerMs
          const v = pk[Math.floor(ms / 10)] ?? 0
          const bh = Math.max(1, v * (h - 14))
          ctx.fillRect(px, y + 12 + (h - 12 - bh) / 2, 1, bh)
        }
      }
      ctx.fillStyle = '#fff'; ctx.fillText(`♪ ${m?.name ?? '?'}`, x + 4, y + 10)
    } else {
      const tx = p.text.find((i) => i.id === it.id)!
      ctx.fillStyle = '#fff'; ctx.fillText(`T  ${tx.text}`, x + 4, y + h / 2 + 3)
    }
    if (s.diff?.added.includes(it.id)) stripes(ctx, x, y, iw, h)
    ctx.restore()
    if (s.diff?.added.includes(it.id)) { ctx.setLineDash([4, 3]); ctx.strokeStyle = '#b39dff'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, iw - 2, h - 1); ctx.setLineDash([]) }
    if (s.diff?.changed.includes(it.id)) { ctx.strokeStyle = '#b39dff'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, iw - 3, h - 2); ctx.lineWidth = 1 }
    if (s.selected === it.id) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, iw - 3, h - 2); ctx.lineWidth = 1 }
    ctx.globalAlpha = 1
  }
  if (s.dropHint) {
    const x = msToX(s.dropHint.ms, s.pxPerMs, s.scrollMs)
    const t = TRACKS[s.dropHint.track]
    ctx.fillStyle = '#38bdf8'; ctx.fillRect(x - 1, RULER_H + t.y, 2, t.h)
  }
  ctx.restore()
  return layout
}

/** Playhead on its own overlay canvas, so playback never redraws the tracks. */
export function drawPlayhead(ctx: CanvasRenderingContext2D, w: number, playheadMs: number, pxPerMs: number, scrollMs: number): void {
  ctx.clearRect(0, 0, w, CONTENT_H)
  const px = Math.round(msToX(playheadMs, pxPerMs, scrollMs)) + 0.5
  if (px < HEADER_W) return
  ctx.strokeStyle = '#f5f5f5'; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, CONTENT_H); ctx.stroke()
  ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 7); ctx.fill()
}

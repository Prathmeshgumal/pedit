import type { TextItem } from '@shared/model'
import interRegular from '../../../resources/fonts/Inter-Regular.ttf?url'
import interBold from '../../../resources/fonts/Inter-Bold.ttf?url'

let fontsReady: Promise<void> | null = null

/** Load the bundled Inter faces once; every render awaits this. */
export function loadFonts(): Promise<void> {
  fontsReady ??= (async () => {
    const faces = [new FontFace('Inter', `url(${interRegular})`, { weight: '400' }), new FontFace('Inter', `url(${interBold})`, { weight: '700' })]
    for (const f of faces) document.fonts.add(await f.load())
  })()
  return fontsReady
}

function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word } else line = next
    }
    lines.push(line)
  }
  return lines
}

interface Layout { px: number; lines: string[]; ascent: number; lineH: number; blockH: number; maxW: number; pad: number; cx: number; top: number }

function layout(ctx: OffscreenCanvasRenderingContext2D, item: TextItem, width: number, height: number): Layout {
  const s = item.style
  const px = Math.round((height * s.sizePct) / 100)
  ctx.font = `${s.bold ? 700 : 400} ${px}px Inter`
  const lines = wrap(ctx, item.text, width * 0.9)
  const m = ctx.measureText('Hg')
  const ascent = m.fontBoundingBoxAscent, descent = m.fontBoundingBoxDescent
  const lineH = Math.round(px * 1.2)
  const blockH = lineH * (lines.length - 1) + ascent + descent
  const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const margin = height * 0.08
  const pad = s.background ? px * 0.4 : 0
  let cx = width / 2
  let top: number
  if (s.position === 'custom') { cx = (s.x ?? 0.5) * width; top = (s.y ?? 0.5) * height - blockH / 2 }
  else top = s.position === 'top' ? margin + pad : s.position === 'bottom' ? height - margin - pad - blockH : (height - blockH) / 2
  return { px, lines, ascent, lineH, blockH, maxW, pad, cx, top }
}

/** Where the text block sits in a width×height frame (centre, size incl. background padding, rotation). */
export async function textBox(item: TextItem, width: number, height: number): Promise<{ cx: number; cy: number; w: number; h: number; rotation: number }> {
  await loadFonts()
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  const l = layout(ctx, item, width, height)
  return { cx: l.cx, cy: l.top + l.blockH / 2, w: l.maxW + l.pad * 2, h: l.blockH + l.pad * 2, rotation: item.style.rotation ?? 0 }
}

/** Full-frame transparent canvas with the text drawn as it appears in preview and export. */
export async function renderText(item: TextItem, width: number, height: number): Promise<OffscreenCanvas> {
  await loadFonts()
  const c = new OffscreenCanvas(width, height)
  const ctx = c.getContext('2d')!
  const s = item.style
  const { px, lines, ascent, lineH, blockH, maxW, pad, cx, top } = layout(ctx, item, width, height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  if (s.rotation) {
    const cy = top + blockH / 2
    ctx.translate(cx, cy); ctx.rotate((s.rotation * Math.PI) / 180); ctx.translate(-cx, -cy)
  }
  if (s.background) {
    ctx.fillStyle = s.background
    const r = px * 0.2, x = cx - maxW / 2 - pad, y = top - pad, w = maxW + pad * 2, h = blockH + pad * 2
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill()
  }
  ctx.lineJoin = 'round'
  ctx.lineWidth = (2 * height) / 1080
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.fillStyle = s.color
  lines.forEach((l, i) => {
    const y = top + ascent + i * lineH
    if (!s.background) ctx.strokeText(l, cx, y)
    ctx.fillText(l, cx, y)
  })
  return c
}

export async function renderTextPng(item: TextItem, width: number, height: number): Promise<Uint8Array> {
  const c = await renderText(item, width, height)
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

/** Bounding box of non-transparent pixels (used by tests). */
export async function textBBox(item: TextItem, width: number, height: number): Promise<{ x0: number; y0: number; x1: number; y1: number }> {
  const c = await renderText(item, width, height)
  const d = c.getContext('2d')!.getImageData(0, 0, width, height).data
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (d[(y * width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

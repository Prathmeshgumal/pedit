import type { TextItem } from '@shared/model'
import { textAnimAt } from '@shared/textAnim'
import type { Layer } from '../preview/compositor'
import { renderTextLayer } from './renderText'
import { onFontsChanged } from './fonts'

const MAX = 48
type Hit = { canvas: OffscreenCanvas; cx: number; cy: number }
const cache = new Map<string, Hit | 'pending'>()
onFontsChanged(() => cache.clear())
// timing changes don't change the picture, only when (and how) it is animated
const keyOf = (t: TextItem, w: number, h: number): string => JSON.stringify([t.id, t.text, t.style, w, h])

/** Screen → texture matrix for a layer moved by (dx, dy) (fractions of the frame) and scaled by s around (cx, cy) (fractions). */
export function animUv(dx: number, dy: number, s: number, cx: number, cy: number): number[] {
  // screen q shows texture t = (q - d - c)/s + c
  return [1 / s, 0, 0, 0, 1 / s, 0, cx - (dx + cx) / s, cy - (dy + cy) / s, 1]
}

/** Synchronous layer lookup for the player at time ms; renders missing layers in the background and calls onReady. */
export function textLayers(onReady: () => void): (texts: TextItem[], w: number, h: number, ms?: number) => Layer[] {
  return (texts, w, h, ms) => {
    const out: Layer[] = []
    for (const t of texts) {
      const k = keyOf(t, w, h)
      const hit = cache.get(k)
      if (hit && hit !== 'pending') {
        cache.delete(k); cache.set(k, hit)
        const a = ms === undefined ? null : textAnimAt(t, ms)
        if (!a || (a.alpha === 1 && a.dx === 0 && a.dy === 0 && a.scale === 1)) out.push({ frame: hit.canvas, fit: 'full' })
        else if (a.alpha > 0) out.push({ frame: hit.canvas, fit: 'full', alpha: a.alpha, uv: animUv(a.dx, a.dy, a.scale, hit.cx / w, hit.cy / h) })
        continue
      }
      if (!hit) {
        cache.set(k, 'pending')
        void renderTextLayer(t, w, h).then((c) => {
          cache.set(k, c)
          while (cache.size > MAX) cache.delete(cache.keys().next().value!)
          onReady()
        }, () => cache.delete(k))
      }
    }
    return out
  }
}

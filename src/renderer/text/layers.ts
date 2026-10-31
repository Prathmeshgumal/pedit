import type { TextItem } from '@shared/model'
import type { Layer } from '../preview/compositor'
import { renderText } from './renderText'

const MAX = 48
const cache = new Map<string, OffscreenCanvas | 'pending'>()
const keyOf = (t: TextItem, w: number, h: number): string => JSON.stringify([t.id, t.text, t.style, w, h])

/** Synchronous layer lookup for the player; renders missing layers in the background and calls onReady. */
export function textLayers(onReady: () => void): (texts: TextItem[], w: number, h: number) => Layer[] {
  return (texts, w, h) => {
    const out: Layer[] = []
    for (const t of texts) {
      const k = keyOf(t, w, h)
      const hit = cache.get(k)
      if (hit && hit !== 'pending') { cache.delete(k); cache.set(k, hit); out.push({ frame: hit, fit: 'full' }); continue }
      if (!hit) {
        cache.set(k, 'pending')
        void renderText(t, w, h).then((c) => {
          cache.set(k, c)
          while (cache.size > MAX) cache.delete(cache.keys().next().value!)
          onReady()
        }, () => cache.delete(k))
      }
    }
    return out
  }
}

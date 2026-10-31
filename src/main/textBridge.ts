import { ipcMain, type WebContents } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CH, type RenderedText } from '../shared/ipc'
import type { TextPng } from './export/graph'
import type { ItemId, TextItem } from '../shared/model'

let nextReq = 1
const pending = new Map<number, { resolve: (r: Record<ItemId, RenderedText>) => void; reject: (e: Error) => void }>()

ipcMain.on(CH.textRendered, (_e, reqId: number, pngs: Record<ItemId, RenderedText> | null, err: string | null) => {
  const p = pending.get(reqId)
  if (!p) return
  pending.delete(reqId)
  if (pngs) p.resolve(pngs); else p.reject(new Error(err ?? 'text render failed'))
})

/** Ask the renderer to draw text items (same code as preview) and write them as PNGs into dir. */
export async function renderTextPngs(wc: WebContents, items: TextItem[], w: number, h: number, dir: string): Promise<Record<ItemId, Exclude<TextPng, string>>> {
  if (items.length === 0) return {}
  const reqId = nextReq++
  const pngs = await new Promise<Record<ItemId, RenderedText>>((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    wc.send(CH.textRender, reqId, items, w, h)
    setTimeout(() => { if (pending.delete(reqId)) reject(new Error('text render timed out')) }, 30000)
  })
  await mkdir(dir, { recursive: true })
  const out: Record<ItemId, Exclude<TextPng, string>> = {}
  for (const [id, r] of Object.entries(pngs)) {
    const f = join(dir, `${id}.png`)
    await writeFile(f, r.png)
    out[id] = { path: f, cx: r.cx, cy: r.cy }
  }
  return out
}

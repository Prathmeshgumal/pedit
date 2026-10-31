import { useEffect, useState } from 'react'
import { buildLut, sampleLut, parseCube, type Cube, type ClipLook } from '@shared/look'
import type { FilterPreset } from '@shared/filterPresets'
import { mediaUrl } from '@shared/mediaUrl'
import { edit, useUi } from '../store'
import { useLibrary } from '../library'

const TW = 112, TH = 63

/** The clip the Filters tab works on: the selected one, else the first. */
function useTargetClip(): { id: string; mediaId: string; atMs: number } | null {
  const sel = useUi((s) => s.selectedItemId)
  const video = useUi((s) => s.project?.video)
  const v = video?.find((x) => x.id === sel) ?? video?.[0]
  return v ? { id: v.id, mediaId: v.mediaId, atMs: Math.round((v.inMs + v.outMs) / 2) } : null
}

async function loadPixels(path: string): Promise<ImageData> {
  // fetch + ImageBitmap: an <img> from the media scheme would taint the canvas and block reading pixels
  const img = await createImageBitmap(await (await fetch(mediaUrl(path))).blob())
  const c = new OffscreenCanvas(TW, TH)
  const x = c.getContext('2d')!
  const s = Math.max(TW / img.width, TH / img.height)
  x.drawImage(img, (TW - img.width * s) / 2, (TH - img.height * s) / 2, img.width * s, img.height * s)
  img.close()
  return x.getImageData(0, 0, TW, TH)
}

const cubeCache = new Map<string, Promise<Cube>>()
const cube = (p: string): Promise<Cube> => {
  let c = cubeCache.get(p)
  if (!c) { c = fetch(mediaUrl(p)).then((r) => r.text()).then(parseCube); cubeCache.set(p, c) }
  return c
}

/** A small preview of the frame through a filter (CPU, 17³ LUT is plenty for a thumbnail). */
async function thumb(src: ImageData, f: FilterPreset): Promise<string> {
  const look: ClipLook = { filter: { name: f.name, strength: 1, adjust: f.adjust, lut: f.lut } }
  const lut = buildLut(look, f.lut ? { [f.lut]: await cube(f.lut) } : {}, 17)
  const out = new ImageData(TW, TH)
  for (let i = 0; i < src.data.length; i += 4) {
    const [r, g, b] = sampleLut(lut, [src.data[i] / 255, src.data[i + 1] / 255, src.data[i + 2] / 255], 17)
    out.data[i] = r * 255; out.data[i + 1] = g * 255; out.data[i + 2] = b * 255; out.data[i + 3] = 255
  }
  const vig = (f.adjust.vignette ?? 0) / 100
  if (vig) for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const d = Math.hypot(x - TW / 2, y - TH / 2) / Math.hypot(TW / 2, TH / 2), k = Math.cos(vig * 1.1 * d) ** 4, i = (y * TW + x) * 4
    out.data[i] *= k; out.data[i + 1] *= k; out.data[i + 2] *= k
  }
  const c = new OffscreenCanvas(TW, TH); c.getContext('2d')!.putImageData(out, 0, 0)
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return URL.createObjectURL(blob)
}

export function FiltersTab() {
  const lib = useLibrary()
  const target = useTargetClip()
  const current = useUi((s) => s.project?.video.find((v) => v.id === target?.id)?.look?.filter?.name ?? null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const frameKey = target ? `${target.mediaId}@${target.atMs}` : ''
  useEffect(() => {
    if (!target) { setThumbs({}); return }
    let alive = true
    const urls: string[] = []
    void (async () => {
      const src = await loadPixels(await window.pedit.frameImage(target.mediaId, target.atMs))
      for (const f of lib.filters) {
        if (!alive) return
        try { const u = await thumb(src, f); urls.push(u); setThumbs((t) => ({ ...t, [f.name]: u })) } catch { /* broken LUT: no thumbnail */ }
      }
    })().catch(() => {})
    return () => { alive = false; for (const u of urls) URL.revokeObjectURL(u) }
  }, [frameKey, lib.filters])

  const apply = (f: FilterPreset | null, all = false): void => {
    const p = useUi.getState().project
    const sel = p?.video.find((v) => v.id === useUi.getState().selectedItemId)
    const ids = all || !sel ? p?.video.map((v) => v.id) ?? [] : [sel.id]
    if (!ids.length) { useUi.getState().showToast('Add a clip to the timeline first'); return }
    void edit({ type: 'setLook', ids, filter: f ? { name: f.name, strength: 1, adjust: f.adjust, ...(f.lut ? { lut: f.lut } : {}) } : null })
    if (!sel && !all) useUi.getState().showToast(f ? `${f.name} on every clip (select a clip to change just one)` : 'Filters removed')
  }

  return (
    <div className="space-y-2 p-1">
      <div className="text-[10px] text-neutral-500">{target ? 'Click a look for the selected clip (or every clip when none is selected). Strength and fine-tuning are in Properties.' : 'Add a clip to the timeline to try filters on it.'}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <button data-testid="filter-none" onClick={() => apply(null)} className={`flex h-[84px] flex-col overflow-hidden rounded-lg border text-[10px] ${current === null ? 'border-sky-500' : 'border-neutral-700/60 hover:border-neutral-500'}`}>
          <div className="flex flex-1 items-center justify-center bg-neutral-800 text-neutral-500">Original</div>
          <div className="px-1 py-0.5 text-left text-neutral-300">None</div>
        </button>
        {lib.filters.map((f) => (
          <button key={`${f.source}:${f.name}`} data-testid={`filter-${f.name}`} title={f.description} onClick={() => apply(f)}
            className={`flex h-[84px] flex-col overflow-hidden rounded-lg border text-[10px] ${current === f.name ? 'border-sky-500' : 'border-neutral-700/60 hover:border-neutral-500'}`}>
            {thumbs[f.name] ? <img src={thumbs[f.name]} className="h-[63px] w-full object-cover" /> : <div className="h-[63px] w-full bg-neutral-800" />}
            <div className="truncate px-1 py-0.5 text-left text-neutral-300">{f.name}{f.source === 'user' && <span className="text-sky-400"> •</span>}</div>
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <button className="btn flex-1" disabled={!target} onClick={() => { const n = current; const f = lib.filters.find((x) => x.name === n) ?? null; apply(f, true) }}>Use this look on all clips</button>
      </div>
      <button className="btn w-full" onClick={() => void window.pedit.pickLut().then((f) => { if (f) useUi.getState().showToast(`Added filter ${f.name}`) }).catch((e: Error) => useUi.getState().showToast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))}>Add a LUT file (.cube)…</button>
    </div>
  )
}

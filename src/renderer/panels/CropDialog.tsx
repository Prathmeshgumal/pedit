import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { IDENTITY_TRANSFORM, type ClipTransform } from '@shared/model'
import { mediaUrl } from '@shared/mediaUrl'
import { edit, useUi } from '../store'
import { playheadMs } from '../timeline/actions'

type Rect = ClipTransform['crop']
const RATIOS: Array<[string, number | 'free' | 'orig']> = [['Free', 'free'], ['Original', 'orig'], ['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:3', 4 / 3]]
const MIN = 0.05
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Largest centred box of pixel ratio r on a W×H frame, in 0..1 units. */
function fitRatio(r: number, W: number, H: number): Rect {
  const w = r > W / H ? 1 : (r * H) / W
  const h = r > W / H ? W / (r * H) : 1
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

/** CapCut-style crop: a box over the frame at the playhead, with ratio presets. */
export function CropDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const project = useUi((s) => s.project)
  const clip = project?.video.find((v) => v.id === itemId)
  const media = clip && project?.media.find((m) => m.id === clip.mediaId)
  const [src, setSrc] = useState<string | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<Rect>(clip?.transform?.crop ?? IDENTITY_TRANSFORM.crop)
  const [ratio, setRatio] = useState<number | 'free' | 'orig'>('free')
  const imgBox = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'move' | 'corner'; px: number; py: number; r0: Rect } | null>(null)

  useEffect(() => {
    if (!clip || !media) return
    const t = playheadMs()
    const sourceMs = media.kind === 'image' ? 0 : clip.inMs + clamp(t - clip.startMs, 0, clip.outMs - clip.inMs - 1)
    void window.pedit.frameImage(media.id, sourceMs).then((p) => setSrc(mediaUrl(p)), (e: Error) => useUi.getState().showToast(e.message))
  }, [itemId])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  if (!clip || !media) return null
  const size = nat ?? { w: 16, h: 9 }
  const pxRatio = (r: Rect): number => (r.w * size.w) / (r.h * size.h)
  const lockedRatio = ratio === 'free' ? null : ratio === 'orig' ? size.w / size.h : ratio

  // presets need the frame's real size, so they wait for it to load
  const pick = (r: number | 'free' | 'orig', sz = nat): void => {
    if (!sz) return
    setRatio(r)
    if (r === 'orig') setRect({ x: 0, y: 0, w: 1, h: 1 })
    else if (r !== 'free') setRect(fitRatio(r, sz.w, sz.h))
  }

  const down = (e: PointerEvent, kind: 'move' | 'corner'): void => {
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, px: e.clientX, py: e.clientY, r0: rect }
  }
  const move = (e: PointerEvent): void => {
    const d = drag.current, box = imgBox.current
    if (!d || !box) return
    const dx = (e.clientX - d.px) / box.clientWidth, dy = (e.clientY - d.py) / box.clientHeight
    const r = d.r0
    if (d.kind === 'move') { setRect({ ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) }); return }
    let w = clamp(r.w + dx, MIN, 1 - r.x), h = clamp(r.h + dy, MIN, 1 - r.y)
    if (lockedRatio) {
      // keep the pixel ratio: follow the wider drag, then shrink both to fit
      h = (w * size.w) / (lockedRatio * size.h)
      if (h > 1 - r.y) { h = 1 - r.y; w = (h * lockedRatio * size.h) / size.w }
    }
    setRect({ ...r, w, h })
  }
  const up = (): void => { drag.current = null }

  const apply = (): void => {
    const q = (v: number): number => Math.round(v * 10000) / 10000
    void edit({ type: 'setTransform', id: itemId, transform: { crop: { x: q(rect.x), y: q(rect.y), w: q(rect.w), h: q(rect.h) } } })
    onClose()
  }

  const pct = (v: number): string => `${v * 100}%`
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onPointerDown={onClose}>
      <div data-testid="crop-dialog" className="flex w-[760px] flex-col gap-3 rounded-lg bg-neutral-800 p-4 text-xs shadow-xl" onPointerDown={(e) => e.stopPropagation()}>
        <div className="text-sm text-neutral-100">Crop · <span className="text-neutral-400">{media.name}</span></div>
        <div className="flex h-[420px] items-center justify-center bg-black">
          {src ? (
            <div ref={imgBox} className="relative max-h-full max-w-full select-none" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <img src={src} draggable={false} className="block max-h-[420px] max-w-[728px]" onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
              <div data-testid="crop-box" className="absolute cursor-move border-2 border-white" onPointerDown={(e) => down(e, 'move')}
                style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h), boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}>
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }, (_, i) => <div key={i} className="border border-white/20" />)}
                </div>
                <div data-testid="crop-corner" className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize bg-white" onPointerDown={(e) => down(e, 'corner')} />
              </div>
            </div>
          ) : <span className="text-neutral-500">Loading frame…</span>}
        </div>
        <div className="flex items-center gap-1">
          {RATIOS.map(([label, r]) => (
            <button key={label} data-testid="crop-ratio" disabled={!nat} className={`rounded px-2 py-1 ${ratio === r ? 'bg-sky-500/30 text-sky-100' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'}`}
              onClick={() => pick(r)}>{label}</button>
          ))}
          <span className="ml-2 text-neutral-500">{Math.round(rect.w * size.w)}×{Math.round(rect.h * size.h)} · {pxRatio(rect).toFixed(2)}</span>
          <span className="ml-auto flex gap-2">
            <button className="btn" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}>Reset</button>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button data-testid="crop-apply" className="btn-primary" disabled={!nat} onClick={apply}>Apply</button>
          </span>
        </div>
      </div>
    </div>
  )
}

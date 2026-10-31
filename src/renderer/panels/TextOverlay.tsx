import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { TextItem } from '@shared/model'
import { edit, useUi } from '../store'
import { textBox } from '../text/renderText'

type Box = { cx: number; cy: number; w: number; h: number; rotation: number }
type Drag =
  | { kind: 'move'; sx: number; sy: number; dx: number; dy: number }
  | { kind: 'scale'; d0: number; f: number }
  | { kind: 'rotate'; deg: number }

/**
 * Click-to-select boxes over the text visible at the playhead, with CapCut-style handles on the selected one:
 * drag the box to move, the corner to resize, the top knob to rotate. Each gesture is one edit on release.
 */
export function TextOverlay({ timeMs, width, height }: { timeMs: number; width: number; height: number }) {
  const project = useUi((s) => s.project)
  const selected = useUi((s) => s.selectedItemId)
  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const [drag, setDrag] = useState<Drag | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const W = project?.settings.width ?? 1920, H = project?.settings.height ?? 1080
  const k = width / W // css px per frame px
  const visible = (project?.text ?? []).filter((t) => timeMs >= t.startMs && timeMs < t.startMs + t.durationMs)
  const key = JSON.stringify(visible.map((t) => [t.id, t.text, t.style])) + `${W}x${H}`

  useEffect(() => {
    let alive = true
    void Promise.all(visible.map(async (t) => [t.id, await textBox(t, W, H)] as const)).then((r) => { if (alive) setBoxes(Object.fromEntries(r)) })
    return () => { alive = false }
  }, [key])

  if (!project || !width) return null
  const sel = visible.find((t) => t.id === selected)

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = root.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const begin = (e: PointerEvent, t: TextItem, kind: Drag['kind']): void => {
    e.stopPropagation(); e.preventDefault()
    useUi.getState().selectItem(t.id)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const b = boxes[t.id]
    const p = local(e)
    if (kind === 'move') setDrag({ kind, sx: p.x, sy: p.y, dx: 0, dy: 0 })
    else if (b && kind === 'scale') setDrag({ kind, d0: Math.hypot(p.x - b.cx * k, p.y - b.cy * k), f: 1 })
    else if (b) setDrag({ kind: 'rotate', deg: b.rotation })
  }

  const move = (e: PointerEvent): void => {
    if (!drag || !sel) return
    const b = boxes[sel.id]
    const p = local(e)
    if (drag.kind === 'move') setDrag({ ...drag, dx: p.x - drag.sx, dy: p.y - drag.sy })
    else if (drag.kind === 'scale' && b) setDrag({ ...drag, f: Math.hypot(p.x - b.cx * k, p.y - b.cy * k) / Math.max(1, drag.d0) })
    else if (drag.kind === 'rotate' && b) {
      let deg = (Math.atan2(p.x - b.cx * k, -(p.y - b.cy * k)) * 180) / Math.PI
      if (Math.abs(deg) < 4) deg = 0 // snap upright
      setDrag({ kind: 'rotate', deg: Math.round(deg) })
    }
  }

  const end = (): void => {
    if (!drag || !sel) { setDrag(null); return }
    const b = boxes[sel.id]
    const s = sel.style
    if (drag.kind === 'move' && b && (Math.abs(drag.dx) > 2 || Math.abs(drag.dy) > 2)) {
      const x = Math.min(1, Math.max(0, (b.cx * k + drag.dx) / width))
      const y = Math.min(1, Math.max(0, (b.cy * k + drag.dy) / height))
      void edit({ type: 'updateText', id: sel.id, style: { position: 'custom', x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } })
      // show the box where it was dropped right away; the exact box is re-measured (async) after the edit
      setBoxes((bs) => ({ ...bs, [sel.id]: { ...b, cx: x * W, cy: y * H } }))
    } else if (drag.kind === 'scale' && Math.abs(drag.f - 1) > 0.02) {
      if (b) setBoxes((bs) => ({ ...bs, [sel.id]: { ...b, w: b.w * drag.f, h: b.h * drag.f } }))
      void edit({ type: 'updateText', id: sel.id, style: { sizePct: Math.round(Math.min(30, Math.max(2, s.sizePct * drag.f)) * 10) / 10 } })
    } else if (drag.kind === 'rotate' && drag.deg !== (s.rotation ?? 0)) {
      if (b) setBoxes((bs) => ({ ...bs, [sel.id]: { ...b, rotation: drag.deg } }))
      void edit({ type: 'updateText', id: sel.id, style: { rotation: drag.deg } })
    }
    setDrag(null)
  }

  return (
    <div ref={root} className="absolute inset-0" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {visible.map((t) => {
        const b = boxes[t.id]
        if (!b) return null
        const isSel = t.id === selected
        const live = isSel && drag
        const dx = live && drag.kind === 'move' ? drag.dx : 0
        const dy = live && drag.kind === 'move' ? drag.dy : 0
        const f = live && drag.kind === 'scale' ? drag.f : 1
        const rot = live && drag.kind === 'rotate' ? drag.deg : b.rotation
        const w = b.w * k * f + 8, h = b.h * k * f + 8
        return (
          <div key={t.id} data-testid={isSel ? 'text-box' : 'text-hit'}
            className={`absolute cursor-move ${isSel ? 'outline outline-1 outline-white' : 'hover:outline hover:outline-1 hover:outline-white/40'}`}
            style={{ left: b.cx * k + dx - w / 2, top: b.cy * k + dy - h / 2, width: w, height: h, transform: `rotate(${rot}deg)` }}
            onPointerDown={(e) => begin(e, t, 'move')}>
            {isSel && (
              <>
                <div data-testid="text-handle-scale" className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-neutral-900 bg-white"
                  onPointerDown={(e) => begin(e, t, 'scale')} />
                <div data-testid="text-handle-rotate" className="absolute -top-6 left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-neutral-900 bg-white"
                  onPointerDown={(e) => begin(e, t, 'rotate')} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { MAIN_MIN, MIN_SIZE, PREVIEW_MIN, useLayout, type PanelKey } from '../layout'

/** Where the panel sits relative to the border: 'before' grows when the border moves right/down. */
const SIDE: Record<PanelKey, 'before' | 'after'> = { media: 'before', props: 'after', chat: 'after', timeline: 'after' }

/** The size of a panel right now, and how much more it can take before the preview / top row hits its minimum. */
function measure(k: PanelKey): { size: number; room: number } | null {
  const el = document.querySelector<HTMLElement>(`[data-panel="${k}"]`)
  // the preview takes up the slack in both directions: its width for side panels, its height (the top row) for the timeline
  const flex = document.querySelector<HTMLElement>('[data-panel="preview"]')
  if (!el || !flex) return null
  const r = el.getBoundingClientRect(), f = flex.getBoundingClientRect()
  return k === 'timeline' ? { size: r.height, room: f.height - MAIN_MIN } : { size: r.width, room: f.width - PREVIEW_MIN }
}

const clamp = (k: PanelKey, v: number, start: number, room: number): number => Math.max(MIN_SIZE[k], Math.min(start + Math.max(0, room), v))

/**
 * A draggable border between panels. Drag it, or focus it and use the arrow keys (Shift for bigger steps);
 * double-click puts the panel back to its default size.
 */
export function Splitter({ panel, style }: { panel: PanelKey; style: CSSProperties }) {
  const vertical = panel === 'timeline' // the border is horizontal and moves up/down
  const setSize = useLayout((s) => s.setSize)
  const size = useLayout((s) => s.sizes[panel])
  const drag = useRef<{ pos: number; size: number; room: number } | null>(null)
  const sign = SIDE[panel] === 'before' ? 1 : -1

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const m = measure(panel)
    if (!m) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pos: vertical ? e.clientY : e.clientX, size: m.size, room: m.room }
    document.body.classList.add(vertical ? 'resizing-row' : 'resizing-col')
  }
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const delta = ((vertical ? e.clientY : e.clientX) - d.pos) * sign
    setSize(panel, clamp(panel, d.size + delta, d.size, d.room))
  }
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('resizing-row', 'resizing-col')
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const keys = vertical ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 }
    const dir = keys[e.key as keyof typeof keys]
    if (!dir) return
    e.preventDefault()
    e.stopPropagation() // not the timeline's arrow-key shortcuts
    const m = measure(panel)
    if (!m) return
    setSize(panel, clamp(panel, m.size + dir * sign * (e.shiftKey ? 64 : 16), m.size, m.room))
  }

  const name = { media: 'media panel', props: 'properties panel', chat: 'Claude chat', timeline: 'timeline' }[panel]
  return (
    <div role="separator" tabIndex={0} data-testid={`splitter-${panel}`} aria-label={`Resize the ${name}`}
      aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuenow={size ?? undefined}
      title="Drag to resize · double-click to reset"
      className={`splitter ${vertical ? 'splitter-row' : 'splitter-col'}`} style={style}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}
      onDoubleClick={() => setSize(panel, null)} onKeyDown={onKey} />
  )
}

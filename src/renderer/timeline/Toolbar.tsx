import { memo, type ReactNode } from 'react'
import { useUi } from '../store'
import { canAct, deleteSelected, deleteSide, mirrorSelected, rotateSelected, splitAtPlayhead } from './actions'

export const MIN_ZOOM = 0.001 // px per ms (1px = 1s)
export const MAX_ZOOM = 0.5
const toSlider = (z: number): number => Math.round((Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * 100)
const fromSlider = (v: number): number => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, v / 100)

function Tool({ id, title, disabled, onClick, children, on }: { id: string; title: string; disabled?: boolean; onClick: () => void; children: ReactNode; on?: boolean }) {
  return (
    <button data-testid={id} title={title} disabled={disabled} data-on={on === undefined ? undefined : String(on)} onClick={onClick}
      className={`flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-[13px] leading-none hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent ${on ? 'bg-sky-500/25 text-sky-200' : 'text-neutral-300'}`}>
      {children}
    </button>
  )
}
const Sep = () => <span className="mx-1 h-4 w-px bg-neutral-700" />

/**
 * CapCut-style row of tools above the timeline ruler.
 * Takes whether a playhead tool applies (not the playhead itself) so it does not re-render on every frame while playing.
 */
export const Toolbar = memo(function Toolbar({ canSplit, pxPerMs, setZoom, fit, onFreeze, onCrop }: {
  canSplit: boolean; pxPerMs: number; setZoom: (z: number) => void; fit: () => void; onFreeze?: () => void; onCrop?: () => void
}) {
  const session = useUi((s) => s.session)
  const sel = useUi((s) => s.selectedItemId)
  const snapping = useUi((s) => s.snapping)
  const tool = useUi((s) => s.tool)
  const p = session?.view ?? null
  const can = { ...canAct(p, sel, 0), split: canSplit }
  return (
    <div data-testid="timeline-toolbar" className="flex items-center gap-0.5 pb-1">
      <Tool id="undo" title="Undo (Ctrl+Z)" disabled={!session?.canUndo} onClick={() => void window.pedit.undo()}>↶</Tool>
      <Tool id="redo" title="Redo (Ctrl+Shift+Z)" disabled={!session?.canRedo} onClick={() => void window.pedit.redo()}>↷</Tool>
      <Sep />
      <Tool id="tool-select" title="Select and move (V)" on={tool === 'select'} onClick={() => useUi.getState().setTool('select')}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 1l8 5-3.6.8L8.5 11 7 11.7 4.9 7.5 2 10z" /></svg>
      </Tool>
      <Tool id="tool-blade" title="Blade: click a clip to cut it there (B)" on={tool === 'blade'} onClick={() => useUi.getState().setTool(tool === 'blade' ? 'select' : 'blade')}>✂</Tool>
      <Sep />
      <Tool id="tool-split" title="Split at the playhead (S / Ctrl+B)" disabled={!can.split} onClick={splitAtPlayhead}>⫼</Tool>
      <Tool id="tool-del-left" title="Delete left (Q)" disabled={!can.split} onClick={() => deleteSide('left')}>⇤</Tool>
      <Tool id="tool-del-right" title="Delete right (W)" disabled={!can.split} onClick={() => deleteSide('right')}>⇥</Tool>
      <Tool id="tool-delete" title="Delete (Del)" disabled={!can.del} onClick={deleteSelected}>🗑</Tool>
      <Sep />
      <Tool id="tool-freeze" title="Freeze frame" disabled={!can.clip || !onFreeze} onClick={() => onFreeze?.()}>❄</Tool>
      <Tool id="tool-mirror" title="Mirror" disabled={!can.clip} onClick={mirrorSelected}>⇋</Tool>
      <Tool id="tool-rotate" title="Rotate 90°" disabled={!can.clip} onClick={rotateSelected}>⟳</Tool>
      <Tool id="tool-crop" title="Crop" disabled={!can.clip || !onCrop} onClick={() => onCrop?.()}>⛶</Tool>
      {session?.draftActive && <span className="ml-2 rounded bg-violet-500/30 px-1.5 text-[10px] text-violet-200">Showing Claude's draft</span>}
      <span className="ml-auto" />
      <Tool id="tool-snap" title="Snapping (N)" on={snapping} onClick={() => useUi.getState().setSnapping(!snapping)}>🧲</Tool>
      <Sep />
      <Tool id="zoom-out" title="Zoom out (Ctrl+-)" onClick={() => setZoom(Math.max(MIN_ZOOM, pxPerMs / 1.5))}>－</Tool>
      <input data-testid="zoom" type="range" min={0} max={100} value={toSlider(pxPerMs)} className="w-24 accent-sky-500"
        onChange={(e) => setZoom(fromSlider(Number(e.target.value)))} />
      <Tool id="zoom-in" title="Zoom in (Ctrl+=)" onClick={() => setZoom(Math.min(MAX_ZOOM, pxPerMs * 1.5))}>＋</Tool>
      <Tool id="zoom-fit" title="Fit the whole timeline" onClick={fit}>Fit</Tool>
    </div>
  )
})

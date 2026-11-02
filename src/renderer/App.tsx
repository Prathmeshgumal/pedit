import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_SHARE, MAIN_MIN, MIN_SIZE, PREVIEW_MIN, gridTemplate, useLayout, type PanelKey } from './layout'
import { Splitter } from './ui/Splitter'
import { connectStore, useUi } from './store'
import { TopBar } from './panels/TopBar'
import { MediaPanel } from './panels/MediaPanel'
import { PreviewPanel } from './panels/PreviewPanel'
import { PropertiesPanel } from './panels/PropertiesPanel'
import { ChatPanel } from './panels/ChatPanel'
import { Welcome } from './Welcome'
import { TimelineCanvas } from './timeline/TimelineCanvas'
import { Toast } from './Toast'
import { ExportDialog } from './panels/ExportDialog'
import { Overlays } from './ContextMenu'
import { handleAppShortcut } from './appMenu'

let connected = false

export function App() {
  useEffect(() => { if (!connected) { connected = true; connectStore() } }, [])
  const project = useUi((s) => s.project)
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    const onMenu = (e: Event): void => {
      const p = useUi.getState().project
      if ((e as CustomEvent<string>).detail === 'export' && p?.video.length) setExporting(true)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      handleAppShortcut(e)
    }
    window.addEventListener('pedit-menu', onMenu)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pedit-menu', onMenu); window.removeEventListener('keydown', onKey) }
  }, [])
  return (
    <div data-testid="app-root" className="h-full">
      {project ? (
        <Workspace onExport={() => setExporting(true)} />
      ) : <Welcome />}
      {exporting && project && <ExportDialog onClose={() => setExporting(false)} />}
      <Overlays />
      <Toast />
    </div>
  )
}

/** Grid cell for one panel: the panel fills it and can shrink below its content size. */
const cell = (row: string, col: string, panel?: string, hidden = false): { className: string; style: CSSProperties; 'data-panel'?: string } =>
  ({ className: `cell${hidden ? ' hidden' : ''}`, style: { gridRow: row, gridColumn: col }, 'data-panel': panel })

/**
 * The editor's panels, with draggable borders between them. Columns: media | preview | properties | Claude chat;
 * the timeline runs under the first three. The chat can be closed completely (it stays mounted, so a running
 * turn and a half-written message survive).
 */
function Workspace({ onExport }: { onExport: () => void }) {
  const sizes = useLayout((s) => s.sizes)
  const chatOpen = useLayout((s) => s.chatOpen)
  const grid = useRef<HTMLDivElement>(null)
  const { columns, rows } = gridTemplate(sizes, chatOpen)

  // when the window gets smaller, give back room from dragged panels so the preview keeps its minimum
  useEffect(() => {
    const el = grid.current
    if (!el) return
    const fit = (): void => {
      const { sizes: s, chatOpen: open, setSize } = useLayout.getState()
      const pad = 12, gutters = open ? 18 : 12
      const inner = el.clientWidth - pad
      const side = (open ? ['chat', 'props', 'media'] : ['props', 'media']) as PanelKey[]
      // how far the side panels plus the preview's minimum overflow the window (default-size panels count at their share)
      let over = PREVIEW_MIN + gutters - inner
      for (const k of side) over += s[k] ?? Math.max(MIN_SIZE[k], (DEFAULT_SHARE[k] / 100) * inner)
      // shrink dragged panels in this order, never below their minimum
      for (const k of side) {
        const v = s[k]
        if (over <= 0 || v === null) continue
        const next = Math.max(MIN_SIZE[k], v - over)
        over -= v - next
        if (next !== v) setSize(k, next)
      }
      const t = s.timeline
      if (t !== null) {
        const top = el.querySelector<HTMLElement>('[data-panel="topbar"]')?.offsetHeight ?? 40
        const maxT = el.clientHeight - pad - top - 12 - MAIN_MIN
        if (t > maxT) setSize('timeline', Math.max(MIN_SIZE.timeline, maxT))
      }
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [chatOpen])

  return (
    <div ref={grid} data-testid="workspace" data-chat-open={String(chatOpen)} className="grid h-full p-1.5"
      style={{ gridTemplateColumns: columns, gridTemplateRows: rows }}>
      <div {...cell('1', '1 / -1', 'topbar')}><TopBar onExport={onExport} /></div>
      <div {...cell('3', '1', 'media')}><MediaPanel /></div>
      <Splitter panel="media" style={{ gridRow: '3', gridColumn: '2' }} />
      <div {...cell('3', '3', 'preview')}><PreviewPanel /></div>
      <Splitter panel="props" style={{ gridRow: '3', gridColumn: '4' }} />
      <div {...cell('3', '5', 'props')}><PropertiesPanel /></div>
      {chatOpen && <Splitter panel="chat" style={{ gridRow: '3 / 6', gridColumn: '6' }} />}
      <div {...cell('3 / 6', '7', 'chat', !chatOpen)}><ChatPanel /></div>
      <Splitter panel="timeline" style={{ gridRow: '4', gridColumn: chatOpen ? '1 / 6' : '1 / -1' }} />
      <div {...cell('5', chatOpen ? '1 / 6' : '1 / -1', 'timeline')}><TimelineCanvas /></div>
    </div>
  )
}

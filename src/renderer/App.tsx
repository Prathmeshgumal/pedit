import { useEffect, useState } from 'react'
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
        <div className="grid h-full gap-1.5 p-1.5" style={{ gridTemplateColumns: '18% 1fr 17% 25%', gridTemplateRows: 'auto 1fr 34%' }}>
          <TopBar onExport={() => setExporting(true)} />
          <MediaPanel />
          <PreviewPanel />
          <PropertiesPanel />
          <ChatPanel />
          <TimelineCanvas />
        </div>
      ) : <Welcome />}
      {exporting && project && <ExportDialog onClose={() => setExporting(false)} />}
      <Overlays />
      <Toast />
    </div>
  )
}

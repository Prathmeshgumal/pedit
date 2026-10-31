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
import { renameProject } from './panels/TopBar'

let connected = false

export function App() {
  useEffect(() => { if (!connected) { connected = true; connectStore() } }, [])
  const project = useUi((s) => s.project)
  const [exporting, setExporting] = useState(false)
  useEffect(() => window.pedit.onMenu((a) => {
    const p = useUi.getState().project
    if (!p) return
    if (a === 'export' && p.video.length) setExporting(true)
    else if (a === 'rename') void renameProject(p.name)
    else if (a === 'import') void window.pedit.pickImport('files').then((paths) => { if (paths.length) return window.pedit.importPaths(paths) })
    else window.dispatchEvent(new CustomEvent('pedit-menu', { detail: a }))
  }), [])
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

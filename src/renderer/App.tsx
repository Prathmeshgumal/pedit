import { useEffect } from 'react'
import { connectStore, useUi } from './store'
import { TopBar } from './panels/TopBar'
import { MediaPanel } from './panels/MediaPanel'
import { PreviewPanel } from './panels/PreviewPanel'
import { PropertiesPanel } from './panels/PropertiesPanel'
import { ChatPanel } from './panels/ChatPanel'
import { Welcome } from './Welcome'

let connected = false

export function App() {
  useEffect(() => { if (!connected) { connected = true; connectStore() } }, [])
  const project = useUi((s) => s.project)
  return (
    <div data-testid="app-root" className="h-full">
      {project ? (
        <div className="grid h-full gap-1.5 p-1.5" style={{ gridTemplateColumns: '18% 1fr 17% 25%', gridTemplateRows: 'auto 1fr 34%' }}>
          <TopBar />
          <MediaPanel />
          <PreviewPanel />
          <PropertiesPanel />
          <ChatPanel />
          <div data-testid="timeline" className="panel" style={{ gridColumn: '1 / 4' }}>
            <div className="panel-title">Timeline</div>
            <div className="text-xs text-neutral-500">Timeline editing arrives in Milestone 2.</div>
          </div>
        </div>
      ) : <Welcome />}
    </div>
  )
}

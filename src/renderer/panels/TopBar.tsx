import { useUi } from '../store'
import { openMenu, promptDialog } from '../ContextMenu'

export async function renameProject(current: string): Promise<void> {
  const name = await promptDialog('Rename project', current)
  if (name && name !== current) await window.pedit.renameProject(name).catch((e: Error) => useUi.getState().showToast(e.message))
}

export function TopBar({ onExport }: { onExport?: () => void }) {
  const project = useUi((s) => s.project)
  return (
    <div className="panel flex items-center gap-4 px-3 py-1.5 text-xs text-neutral-400" style={{ gridColumn: '1 / 5' }}>
      <span className="font-semibold text-neutral-200">pedit</span>
      <button data-testid="project-name" className="rounded px-1 text-neutral-200 hover:bg-neutral-800" title="Project menu"
        onClick={(e) => openMenu(e, [
          { label: 'Rename…', onClick: () => void renameProject(project?.name ?? '') },
          { label: 'Save a copy…', onClick: () => void window.pedit.saveProjectCopy() },
          { label: 'Close project', onClick: () => void window.pedit.closeProject() }
        ])}>{project?.name}</button>
      <button data-testid="export" className="btn-primary ml-auto" disabled={!project || project.video.length === 0 || !onExport} onClick={onExport}>Export</button>
    </div>
  )
}

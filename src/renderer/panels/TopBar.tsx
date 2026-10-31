import { useUi, edit } from '../store'
import type { Aspect } from '@shared/model'
import { openMenu, promptDialog } from '../ContextMenu'

export async function renameProject(current: string): Promise<void> {
  const name = await promptDialog('Rename project', current)
  if (name && name !== current) await window.pedit.renameProject(name).catch((e: Error) => useUi.getState().showToast(e.message))
}

export function TopBar({ onExport }: { onExport?: () => void }) {
  const project = useUi((s) => s.project)
  const session = useUi((s) => s.session)
  return (
    <div className="panel flex items-center gap-4 px-3 py-1.5 text-xs text-neutral-400" style={{ gridColumn: '1 / 5' }}>
      <span className="font-semibold text-neutral-200">pedit</span>
      <button data-testid="project-name" className="rounded px-1 text-neutral-200 hover:bg-neutral-800" title="Project menu"
        onClick={(e) => openMenu(e, [
          { label: 'Rename…', onClick: () => void renameProject(project?.name ?? '') },
          { label: 'Save a copy…', onClick: () => void window.pedit.saveProjectCopy() },
          { label: 'Close project', onClick: () => void window.pedit.closeProject() }
        ])}>{project?.name}</button>
      <span className="flex gap-1">
        <button data-testid="undo" className="btn" disabled={!session?.canUndo} onClick={() => void window.pedit.undo()} title="Ctrl+Z">↶ Undo</button>
        <button data-testid="redo" className="btn" disabled={!session?.canRedo} onClick={() => void window.pedit.redo()} title="Ctrl+Shift+Z">↷ Redo</button>
      </span>
      {project && (
        <span className="flex items-center gap-2">
          <select data-testid="aspect" className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-200" value={project.settings.aspect}
            onChange={(e) => void edit({ type: 'setFormat', aspect: e.target.value as Aspect })}>
            <option value="16:9">16:9 YouTube</option><option value="9:16">9:16 Reels</option><option value="1:1">1:1 Square</option>
          </select>
          <span>{project.settings.width}×{project.settings.height} · {project.settings.fps}fps</span>
        </span>
      )}
      <button data-testid="export" className="btn-primary ml-auto" disabled={!project || project.video.length === 0 || !onExport} onClick={onExport}>Export</button>
    </div>
  )
}

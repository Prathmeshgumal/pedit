import { useUi, edit } from '../store'
import type { Aspect } from '@shared/model'

export function TopBar({ onExport }: { onExport?: () => void }) {
  const project = useUi((s) => s.project)
  const session = useUi((s) => s.session)
  return (
    <div className="panel flex items-center gap-4 px-3 py-1.5 text-xs text-neutral-400" style={{ gridColumn: '1 / 5' }}>
      <span className="font-semibold text-neutral-200">pedit</span>
      <span data-testid="project-name">{project?.name}</span>
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

import { useUi } from '../store'

export function TopBar() {
  const project = useUi((s) => s.project)
  return (
    <div className="panel flex items-center gap-4 px-3 py-1.5 text-xs text-neutral-400" style={{ gridColumn: '1 / 5' }}>
      <span className="font-semibold text-neutral-200">pedit</span>
      <span data-testid="project-name">{project?.name}</span>
      <span className="flex gap-1"><button className="btn" disabled>↶ Undo</button><button className="btn" disabled>↷ Redo</button></span>
      <span>{project ? `${project.settings.aspect} · ${project.settings.width}×${project.settings.height} · ${project.settings.fps}fps` : ''}</span>
      <button className="btn-primary ml-auto" disabled>Export</button>
    </div>
  )
}

import { useUi } from '../store'
import { openMenu } from '../ContextMenu'
import { appMenuItems, renameProject } from '../appMenu'

export { renameProject }

export function TopBar({ onExport }: { onExport?: () => void }) {
  const project = useUi((s) => s.project)
  return (
    <div className="panel flex items-center gap-3 px-2 py-1.5 text-xs text-neutral-400" style={{ gridColumn: '1 / 5' }}>
      <AppMenuButton />
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

/** The ☰ button: everything the window's old File / Edit / View menu had. */
export function AppMenuButton({ className = '' }: { className?: string }) {
  return (
    <button data-testid="app-menu" title="Menu" aria-label="Menu"
      className={`flex h-6 w-6 items-center justify-center rounded text-neutral-300 hover:bg-neutral-800 ${className}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const at = { clientX: r.left, clientY: r.bottom + 2, preventDefault: () => {} }
        void appMenuItems().then((items) => openMenu(at, items))
      }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 3.5h10M2 7h10M2 10.5h10" />
      </svg>
    </button>
  )
}

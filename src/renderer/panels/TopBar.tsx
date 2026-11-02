import { useUi } from '../store'
import { openMenu } from '../ContextMenu'
import { appMenuItems, renameProject } from '../appMenu'
import { isDefaultLayout, useLayout } from '../layout'
import { ClaudeMark } from './ChatPanel'

export { renameProject }

export function TopBar({ onExport }: { onExport?: () => void }) {
  const project = useUi((s) => s.project)
  return (
    <div className="panel flex items-center gap-3 px-2 py-1.5 text-xs text-neutral-400">
      <AppMenuButton />
      <span className="font-semibold text-neutral-200">pedit</span>
      <button data-testid="project-name" className="rounded px-1 text-neutral-200 hover:bg-neutral-800" title="Project menu"
        onClick={(e) => openMenu(e, [
          { label: 'Rename…', onClick: () => void renameProject(project?.name ?? '') },
          { label: 'Save a copy…', onClick: () => void window.pedit.saveProjectCopy() },
          { label: 'Close project', onClick: () => void window.pedit.closeProject() }
        ])}>{project?.name}</button>
      <LayoutReset />
      <ChatToggle />
      <button data-testid="export" className="btn-primary" disabled={!project || project.video.length === 0 || !onExport} onClick={onExport}>Export</button>
    </div>
  )
}

/** Puts every panel back to its default size and shows the chat. Greyed out while the layout is already the default. */
function LayoutReset() {
  const isDefault = useLayout((s) => isDefaultLayout(s.sizes, s.chatOpen))
  const reset = useLayout((s) => s.reset)
  return (
    <button data-testid="layout-reset" disabled={isDefault} onClick={reset}
      title={isDefault ? 'The panels are at their default sizes' : 'Reset layout: default panel sizes, chat shown'}
      className="ml-auto flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-35">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <rect x="1.5" y="2" width="11" height="10" rx="1.5" /><path d="M5 2v10M9.5 2v6.5M5 8.5h7.5" />
      </svg>
      Reset layout
    </button>
  )
}

/** Shows or hides the Claude chat panel (Ctrl+J). Lit while the chat is open. */
function ChatToggle() {
  const open = useLayout((s) => s.chatOpen)
  const toggle = useLayout((s) => s.toggleChat)
  return (
    <button data-testid="chat-toggle" aria-pressed={open} title={`${open ? 'Hide' : 'Show'} Claude chat (Ctrl+J)`}
      className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors ${open ? 'bg-[#2e2e36] text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
      onClick={toggle}>
      <ClaudeMark size={12} />Claude
    </button>
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

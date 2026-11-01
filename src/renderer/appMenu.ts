import { useUi } from './store'
import { promptDialog, type MenuItem } from './ContextMenu'

const fail = (e: Error): void => useUi.getState().showToast(e.message)

export async function newProject(): Promise<void> {
  const dir = await window.pedit.pickProjectDir('new')
  if (dir) await window.pedit.newProject(dir, dir.split(/[\\/]/).pop()!.replace(/\.pedit$/, '')).catch(fail)
}

export async function openProject(dir?: string | null): Promise<void> {
  dir ??= await window.pedit.pickProjectDir('open')
  if (dir) await window.pedit.openProject(dir).catch(fail)
}

export async function renameProject(current: string): Promise<void> {
  const name = await promptDialog('Rename project', current)
  if (name && name !== current) await window.pedit.renameProject(name).catch(fail)
}

/** Things other parts of the window do (export dialog, timeline zoom, full-screen preview) go out as a 'pedit-menu' event. */
const emit = (a: string): void => void window.dispatchEvent(new CustomEvent('pedit-menu', { detail: a }))

const importMedia = (): void => void window.pedit.pickImport('files').then((paths) => { if (paths.length) return window.pedit.importPaths(paths) })

/** The app menu (what used to be File / Edit / View in the window's menu bar). */
export async function appMenuItems(): Promise<MenuItem[]> {
  const p = useUi.getState().project
  const recents = (await window.pedit.recentProjects()).filter((r) => r.exists).slice(0, 5)
  const items: MenuItem[] = [
    { label: 'New project…', shortcut: 'Ctrl+N', onClick: () => void newProject() },
    { label: 'Open project…', shortcut: 'Ctrl+O', onClick: () => void openProject() },
    ...recents.map((r, i): MenuItem => ({ label: `Open ${r.name}`, hint: r.dir, sep: i === 0, onClick: () => void openProject(r.dir) }))
  ]
  if (p) items.push(
    { label: 'Import media…', shortcut: 'Ctrl+I', sep: true, onClick: importMedia },
    { label: 'Export video…', shortcut: 'Ctrl+E', disabled: p.video.length === 0, onClick: () => emit('export') },
    { label: 'Rename project…', sep: true, onClick: () => void renameProject(p.name) },
    { label: 'Save a copy…', onClick: () => void window.pedit.saveProjectCopy() },
    { label: 'Close project', shortcut: 'Ctrl+W', onClick: () => void window.pedit.closeProject() },
    { label: 'Undo', shortcut: 'Ctrl+Z', sep: true, onClick: () => void window.pedit.undo() },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', onClick: () => void window.pedit.redo() },
    { label: 'Zoom timeline in', shortcut: 'Ctrl+=', sep: true, onClick: () => emit('zoomIn') },
    { label: 'Zoom timeline out', shortcut: 'Ctrl+-', onClick: () => emit('zoomOut') },
    { label: 'Full-screen preview', shortcut: 'F', onClick: () => emit('fullscreenPreview') }
  )
  items.push(
    { label: 'Full-screen window', shortcut: 'F11', sep: true, onClick: () => window.pedit.windowAction('toggleFullscreen') },
    { label: 'Developer tools', shortcut: 'Ctrl+Shift+I', onClick: () => window.pedit.windowAction('devtools') },
    { label: 'Quit', shortcut: 'Ctrl+Q', sep: true, onClick: () => window.pedit.windowAction('quit') }
  )
  return items
}

/** Window-wide shortcuts that the old menu bar used to provide. Returns true when it handled the key. */
export function handleAppShortcut(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  const p = useUi.getState().project
  let run: (() => void) | null = null
  if (e.key === 'F11') run = () => window.pedit.windowAction('toggleFullscreen')
  else if (mod && e.shiftKey && k === 'i') run = () => window.pedit.windowAction('devtools')
  else if (mod && !e.shiftKey && !e.altKey) {
    if (k === 'n') run = () => void newProject()
    else if (k === 'o') run = () => void openProject()
    else if (k === 'q') run = () => window.pedit.windowAction('quit')
    else if (p && k === 'i') run = importMedia
    else if (p && k === 'e') run = () => { if (p.video.length) emit('export') }
    else if (p && k === 'w') run = () => void window.pedit.closeProject()
  }
  if (!run) return false
  e.preventDefault()
  run()
  return true
}

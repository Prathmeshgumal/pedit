import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction, RecentProject } from '../shared/ipc'

export interface MenuHandlers {
  newProject(): void
  openProject(): void
  openRecent(dir: string): void
  saveCopy(): void
  closeProject(): void
  send(a: MenuAction): void
  undo(): void
  redo(): void
}

/** The app menu (File / Edit / View / Window). Rebuilt when the recent list or open project changes. */
export function buildMenu(h: MenuHandlers, recents: RecentProject[], projectOpen: boolean): void {
  const file: MenuItemConstructorOptions[] = [
    { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: h.newProject },
    { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: h.openProject },
    { label: 'Open Recent', submenu: recents.length ? recents.filter((r) => r.exists).map((r) => ({ label: `${r.name}  —  ${r.dir}`, click: () => h.openRecent(r.dir) })) : [{ label: 'No recent projects', enabled: false }] },
    { type: 'separator' },
    { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', enabled: projectOpen, click: () => h.send('import') },
    { label: 'Export Video…', accelerator: 'CmdOrCtrl+E', enabled: projectOpen, click: () => h.send('export') },
    { type: 'separator' },
    { label: 'Rename Project…', enabled: projectOpen, click: () => h.send('rename') },
    { label: 'Save a Copy…', enabled: projectOpen, click: h.saveCopy },
    { label: 'Close Project', accelerator: 'CmdOrCtrl+W', enabled: projectOpen, click: h.closeProject },
    { type: 'separator' },
    { role: 'quit' }
  ]
  const edit: MenuItemConstructorOptions[] = [
    // the timeline handles Ctrl+Z itself; menu items here only act when clicked
    { label: 'Undo', enabled: projectOpen, click: h.undo },
    { label: 'Redo', enabled: projectOpen, click: h.redo },
    { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
  ]
  const view: MenuItemConstructorOptions[] = [
    { label: 'Zoom Timeline In', accelerator: 'CmdOrCtrl+=', enabled: projectOpen, click: () => h.send('zoomIn') },
    { label: 'Zoom Timeline Out', accelerator: 'CmdOrCtrl+-', enabled: projectOpen, click: () => h.send('zoomOut') },
    { label: 'Full-screen Preview', accelerator: 'F', registerAccelerator: false, enabled: projectOpen, click: () => h.send('fullscreenPreview') },
    { type: 'separator' },
    { role: 'togglefullscreen' }, { role: 'toggleDevTools' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: file }, { label: 'Edit', submenu: edit }, { label: 'View', submenu: view }, { role: 'windowMenu' }
  ]))
}

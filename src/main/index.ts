import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CH } from '../shared/ipc'
import { Editor } from './editor'
import { registerMediaProtocol, registerMediaScheme } from './media/protocol'

registerMediaScheme()
// An editor keeps playing smoothly even when partly covered by other windows.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

let win: BrowserWindow | null = null
const send = (ch: string, ...args: unknown[]): void => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args) }
const editor = new Editor({
  state: (st) => send(CH.state, st),
  progress: (id, stage, pct) => send(CH.mediaProgress, id, stage, pct)
})

const lastFile = (): string => join(app.getPath('userData'), 'last-project.json')
function rememberProject(): void {
  if (editor.store) writeFileSync(lastFile(), JSON.stringify({ dir: editor.store.dir }))
}

function registerIpc(): void {
  ipcMain.handle(CH.newProject, async (_e, dir: string, name: string) => { await editor.newProject(dir, name); rememberProject() })
  ipcMain.handle(CH.openProject, async (_e, dir: string) => { await editor.openProject(dir); rememberProject() })
  ipcMain.handle(CH.getState, () => editor.state())
  ipcMain.handle(CH.edit, (_e, cmd) => {
    try { return { ok: true, summary: editor.apply(cmd) } } catch (err) { return { ok: false, error: (err as Error).message } }
  })
  ipcMain.handle(CH.undo, () => editor.session?.undo())
  ipcMain.handle(CH.redo, () => editor.session?.redo())
  ipcMain.handle(CH.acceptDraft, () => editor.session?.acceptDraft())
  ipcMain.handle(CH.rejectDraft, () => editor.session?.rejectDraft())
  ipcMain.handle(CH.pickProjectDir, async (_e, mode: 'new' | 'open') => {
    if (mode === 'new') {
      const r = await dialog.showSaveDialog(win!, { title: 'New project', defaultPath: 'My Project.pedit', buttonLabel: 'Create' })
      if (r.canceled || !r.filePath) return null
      return r.filePath.endsWith('.pedit') ? r.filePath : `${r.filePath}.pedit`
    }
    const r = await dialog.showOpenDialog(win!, { title: 'Open project', properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle(CH.pickImport, async (_e, kind: 'files' | 'folder' = 'files') => {
    const r = await dialog.showOpenDialog(win!, {
      title: kind === 'folder' ? 'Import folder' : 'Import media',
      properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle(CH.importPaths, (_e, paths: string[]) => editor.importPaths(paths))
  ipcMain.handle(CH.relinkMedia, async (_e, id: string) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Locate media', properties: ['openFile'] })
    if (!r.canceled && r.filePaths[0]) await editor.relink(id, r.filePaths[0])
  })
  ipcMain.on(CH.selectMedia, (_e, id: string | null) => editor.select(id))
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1600, height: 960, title: 'pedit', backgroundColor: '#141416',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: false, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerIpc()
  const envDir = process.env.PEDIT_PROJECT_DIR
  try {
    if (envDir) await editor.openOrCreate(envDir)
    else if (existsSync(lastFile())) {
      const { dir } = JSON.parse(readFileSync(lastFile(), 'utf8')) as { dir: string }
      if (existsSync(join(dir, 'project.json'))) await editor.openProject(dir)
    }
  } catch (e) {
    console.error('could not open project', e)
  }
  await createWindow()
})

app.on('before-quit', (e) => {
  if ((app as unknown as { _flushed?: boolean })._flushed) return
  e.preventDefault()
  void editor.flush().finally(() => { (app as unknown as { _flushed?: boolean })._flushed = true; app.quit() })
})
app.on('window-all-closed', () => app.quit())

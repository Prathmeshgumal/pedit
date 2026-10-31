import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { runExport, exportTempDir } from './export/run'
import { detectEncoders } from './media/ffmpeg'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CH } from '../shared/ipc'
import { Editor } from './editor'
import { registerMediaProtocol, registerMediaScheme } from './media/protocol'
import { renderTextPngs } from './textBridge'
import { startMcpServer, type McpHandle } from './mcp/server'
import type { TextItem } from '../shared/model'
import type { ExportOptions } from '../shared/ipc'

registerMediaScheme()
// An editor keeps playing smoothly even when partly covered by other windows.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

let win: BrowserWindow | null = null
let mcp: McpHandle | null = null
const mcpConfigPath = (): string => join(app.getPath('userData'), 'mcp.json')
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

  let exporting: AbortController | null = null
  ipcMain.handle(CH.exportVideo, async (_e, o: ExportOptions) => {
    const st = editor.state()
    if (!st) return { ok: false, error: 'No project open' }
    if (exporting) return { ok: false, error: 'An export is already running' }
    exporting = new AbortController()
    const tmp = await exportTempDir()
    try {
      await runExport(st.real, o, {
        renderTextPngs: (items, w, h) => renderTextPngs(win!.webContents, items, w, h, tmp),
        enc: await detectEncoders(),
        onProgress: (pct) => send(CH.exportProgress, pct),
        signal: exporting.signal
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      exporting = null
      await rm(tmp, { recursive: true, force: true })
    }
  })
  ipcMain.on(CH.cancelExport, () => exporting?.abort())
  ipcMain.handle(CH.pickExportPath, async (_e, name: string) => {
    const r = await dialog.showSaveDialog(win!, { title: 'Export video', defaultPath: join(app.getPath('videos'), name), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (r.canceled || !r.filePath) return null
    return r.filePath.toLowerCase().endsWith('.mp4') ? r.filePath : `${r.filePath}.mp4`
  })
  ipcMain.on(CH.revealFile, (_e, p: string) => shell.showItemInFolder(p))
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1600, height: 960, title: 'pedit', backgroundColor: '#141416',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: false, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  // test hook: lets e2e tests drive main-process helpers through app.evaluate
  ;(globalThis as Record<string, unknown>).__peditMain = { renderTextPngs: (items: TextItem[], w: number, h: number, dir: string) => renderTextPngs(win!.webContents, items, w, h, dir) }
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerIpc()
  mcp = await startMcpServer(() => editor.session)
  await mcp.writeConfig(mcpConfigPath())
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
  void Promise.allSettled([editor.flush(), mcp?.close()]).finally(() => { (app as unknown as { _flushed?: boolean })._flushed = true; app.quit() })
})
app.on('window-all-closed', () => app.quit())

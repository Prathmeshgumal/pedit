import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { runExport, exportTempDir } from './export/run'
import { detectEncoders, ffmpegPath, fontsDir } from './media/ffmpeg'
import { FontLibrary } from './library/fonts'
import { TextStyleLibrary } from './library/textStyles'
import { FilterLibrary } from './library/filters'
import type { Adjust } from '../shared/look'
import { rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CH, type ChatTag, type WindowAction } from '../shared/ipc'
import { Recents } from './recents'
import { SettingsStore } from './settings'
import { CommandError } from '../shared/commands'
import { Editor } from './editor'
import { registerMediaProtocol, registerMediaScheme } from './media/protocol'
import { renderTextPngs } from './textBridge'
import { startMcpServer, type McpHandle } from './mcp/server'
import { ChatController } from './chat'
import type { TextItem, TextStyle } from '../shared/model'
import type { ExportOptions } from '../shared/ipc'

registerMediaScheme()
// An editor keeps playing smoothly even when partly covered by other windows.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

let win: BrowserWindow | null = null
let mcp: McpHandle | null = null
let exporting: { ac: AbortController; done: Promise<unknown> } | null = null
const mcpConfigPath = (): string => join(app.getPath('userData'), 'mcp.json')
const send = (ch: string, ...args: unknown[]): void => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args) }
const editor = new Editor({
  state: (st) => send(CH.state, st),
  progress: (id, stage, pct) => send(CH.mediaProgress, id, stage, pct)
})

const lastFile = (): string => join(app.getPath('userData'), 'last-project.json')
const guidePath = (): string => app.isPackaged ? join(process.resourcesPath, 'editor-guide.md') : join(app.getAppPath(), 'src/main/claude/editor-guide.md')
let settings: SettingsStore | null = null
const getSettings = (): SettingsStore => (settings ??= new SettingsStore(join(app.getPath('userData'), 'settings.json')))
const chat = new ChatController(editor, {
  mcpConfig: () => mcpConfigPath(),
  get guide() { return guidePath() },
  claude: () => { const s = getSettings().current; return { model: s.claudeModel, effort: s.claudeEffort } }
}, (e) => send(CH.chatEvent, e))

let recents: Recents | null = null
let fonts: FontLibrary | null = null
let textStyles: TextStyleLibrary | null = null
let filters: FilterLibrary | null = null
const getFilters = (): FilterLibrary => (filters ??= new FilterLibrary(join(app.getPath('userData'), 'filters.json'), join(app.getPath('userData'), 'luts')))
const getFonts = (): FontLibrary => (fonts ??= new FontLibrary(fontsDir(), join(app.getPath('userData'), 'fonts')))
const getTextStyles = (): TextStyleLibrary => (textStyles ??= new TextStyleLibrary(join(app.getPath('userData'), 'text-styles.json')))
/** Library calls that change it tell the renderer to reload. */
const changed = async <T>(p: Promise<T>): Promise<T> => { const r = await p; send(CH.libraryChanged); return r }
const libraryServices = () => ({
  fonts: { list: () => getFonts().list(), find: (f: string) => getFonts().find(f), addGoogle: (f: string) => changed(getFonts().addGoogle(f)) },
  filters: {
    list: () => getFilters().list(), find: (n: string) => getFilters().find(n),
    save: (n: string, d: string, a: Adjust) => changed(getFilters().save(n, d, a)),
    importCube: (n: string, d: string, p: string, a?: Adjust) => changed(getFilters().importCube(n, d, p, a))
  },
  textStyles: { list: () => getTextStyles().list(), find: (n: string) => getTextStyles().find(n), save: (n: string, d: string, s: Partial<TextStyle>) => changed(getTextStyles().save(n, d, s)) }
})
const getRecents = (): Recents => (recents ??= new Recents(join(app.getPath('userData'), 'recent.json')))

async function rememberProject(): Promise<void> {
  if (editor.store) {
    writeFileSync(lastFile(), JSON.stringify({ dir: editor.store.dir }))
    await getRecents().add(editor.store.dir, editor.store.project.name)
  }
}

async function switchProject(open: () => Promise<void>): Promise<void> {
  await chat.stopAndWait(); await open(); chat.resetProject(); await rememberProject()
}

async function closeProject(): Promise<void> {
  await chat.stopAndWait()
  await editor.close()
  chat.resetProject()
  await rm(lastFile(), { force: true })
}

async function pickProject(mode: 'new' | 'open'): Promise<string | null> {
  if (mode === 'new') {
    const r = await dialog.showSaveDialog(win!, { title: 'New project', defaultPath: 'My Project.pedit', buttonLabel: 'Create' })
    return r.canceled || !r.filePath ? null : r.filePath
  }
  const r = await dialog.showOpenDialog(win!, { title: 'Open project', properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0] ?? null
}

async function saveCopy(): Promise<string | null> {
  if (!editor.store) return null
  const r = await dialog.showSaveDialog(win!, { title: 'Save a copy', defaultPath: `${editor.store.project.name} copy.pedit`, buttonLabel: 'Save copy' })
  if (r.canceled || !r.filePath) return null
  await editor.flush()
  await editor.store.saveCopy(r.filePath)
  return r.filePath
}

function registerIpc(): void {
  ipcMain.handle(CH.newProject, (_e, dir: string, name: string) => switchProject(() => editor.newProject(dir, name)))
  ipcMain.handle(CH.openProject, (_e, dir: string) => switchProject(() => editor.openProject(dir)))
  ipcMain.handle(CH.recentProjects, () => getRecents().list())
  ipcMain.handle(CH.forgetRecent, (_e, dir: string) => getRecents().remove(dir))
  ipcMain.on(CH.windowAction, (_e, a: WindowAction) => {
    if (a === 'quit') app.quit()
    else if (a === 'toggleFullscreen') win?.setFullScreen(!win.isFullScreen())
    else if (a === 'devtools') win?.webContents.toggleDevTools()
  })
  ipcMain.handle(CH.closeProject, () => closeProject())
  ipcMain.handle(CH.renameProject, async (_e, name: string) => { await editor.rename(name); await rememberProject() })
  ipcMain.handle(CH.saveProjectCopy, () => saveCopy())
  ipcMain.handle(CH.removeMedia, (_e, id: string, force?: boolean) => {
    try { editor.apply({ type: 'removeMedia', id, force }, 'user'); return { ok: true } } catch (e) {
      if (e instanceof CommandError && e.code === 'in_use') {
        const st = editor.session!.state()
        const uses = [...st.view.video, ...st.view.audio].filter((i) => i.mediaId === id).length
        return { ok: false, inUse: uses }
      }
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(CH.getStory, () => editor.store ? editor.getStory() : '')
  ipcMain.handle(CH.setStory, (_e, t: string) => editor.setStory(t))
  ipcMain.handle(CH.listFonts, () => getFonts().list())
  ipcMain.handle(CH.addFont, (_e, f: string) => changed(getFonts().addGoogle(f)))
  ipcMain.handle(CH.pickFontFile, async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Add a font file', properties: ['openFile'], filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff2'] }] })
    return r.canceled || !r.filePaths[0] ? null : changed(getFonts().addFile(r.filePaths[0]))
  })
  ipcMain.handle(CH.listFilters, () => getFilters().list())
  ipcMain.handle(CH.saveFilter, (_e, n: string, d: string, a: Adjust) => changed(getFilters().save(n, d, a)))
  ipcMain.handle(CH.pickLut, async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Add a LUT (.cube) as a filter', properties: ['openFile'], filters: [{ name: '3D LUT', extensions: ['cube'] }] })
    const f = r.filePaths[0]
    return r.canceled || !f ? null : changed(getFilters().importCube(basename(f, extname(f)), 'from a LUT file', f))
  })
  ipcMain.handle(CH.listTextStyles, () => getTextStyles().list())
  ipcMain.handle(CH.saveTextStyle, (_e, n: string, d: string, s: Partial<TextStyle>) => changed(getTextStyles().save(n, d, s)))
  ipcMain.handle(CH.getSettings, () => getSettings().get())
  ipcMain.handle(CH.setSettings, (_e, patch) => getSettings().set(patch))
  ipcMain.handle(CH.freezeFrame, async (_e, id: string, atMs: number) => { await editor.freezeFrame(id, atMs) })
  ipcMain.handle(CH.frameImage, (_e, id: string, ms: number) => editor.frameImage(id, ms))
  ipcMain.handle(CH.removeUnusedMedia, () => {
    const ids = editor.unusedMedia()
    for (const id of ids) editor.apply({ type: 'removeMedia', id }, 'user')
    return ids.length
  })
  ipcMain.handle(CH.getState, () => editor.state())
  ipcMain.handle(CH.edit, (_e, cmd) => {
    try { return { ok: true, summary: editor.apply(cmd) } } catch (err) { return { ok: false, error: (err as Error).message } }
  })
  ipcMain.handle(CH.undo, () => editor.session?.undo())
  ipcMain.handle(CH.redo, () => editor.session?.redo())
  ipcMain.handle(CH.acceptDraft, () => { if (!chat.running && editor.session?.state().draftActive) { editor.session.acceptDraft(); chat.noteDraftOutcome('accepted') } })
  ipcMain.handle(CH.rejectDraft, () => { if (!chat.running && editor.session?.state().draftActive) { editor.session.rejectDraft(); chat.noteDraftOutcome('rejected') } })
  ipcMain.handle(CH.sendChat, (_e, text: string, tags: ChatTag[]) => chat.send(text, tags))
  ipcMain.handle(CH.attachToChat, (_e, paths: string[]) => editor.attachFiles(paths))
  ipcMain.handle(CH.attachPastedImage, (_e, png: Uint8Array) => editor.attachPastedImage(png))
  ipcMain.on(CH.stopChat, () => chat.stop())
  ipcMain.handle(CH.chatHistory, () => chat.history())
  ipcMain.handle(CH.claudeStatus, () => chat.status())
  ipcMain.handle(CH.diagnostics, async () => {
    const st = await chat.status()
    return { ffmpeg: ffmpegPath(), encoder: (await detectEncoders()).h264, claude: st.ok ? st.version ?? null : null }
  })
  ipcMain.handle(CH.pickProjectDir, (_e, mode: 'new' | 'open') => pickProject(mode))
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

  ipcMain.handle(CH.exportVideo, async (_e, o: ExportOptions) => {
    const st = editor.state()
    if (!st) return { ok: false, error: 'No project open' }
    if (exporting) return { ok: false, error: 'An export is already running' }
    const ac = new AbortController()
    const job = (async () => {
      const tmp = await exportTempDir()
      try {
        await runExport(st.real, o, {
          renderTextPngs: (items, w, h) => renderTextPngs(win!.webContents, items, w, h, tmp),
          enc: await detectEncoders(),
          onProgress: (pct) => send(CH.exportProgress, pct),
          signal: ac.signal
        })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        await rm(tmp, { recursive: true, force: true })
      }
    })()
    exporting = { ac, done: job }
    try { return await job } finally { exporting = null }
  })
  ipcMain.on(CH.cancelExport, () => exporting?.ac.abort())
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
  await getSettings().get()
  mcp = await startMcpServer(() => editor.session, {
    lookAtMedia: (id, count) => editor.lookAtMedia(id, count),
    freezeFrame: (id, atMs, durationMs, rev) => editor.freezeFrame(id, atMs, durationMs, 'claude', rev),
    getStory: () => editor.getStory(),
    ...libraryServices()
  })
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
  if (editor.store) await rememberProject()
  // no native File/Edit/View bar: the app has its own menu in the top bar
  Menu.setApplicationMenu(null)
  await createWindow()
})

app.on('before-quit', (e) => {
  if ((app as unknown as { _flushed?: boolean })._flushed) return
  e.preventDefault()
  chat.stop()
  exporting?.ac.abort()
  void Promise.allSettled([editor.flush(), mcp?.close(), exporting?.done]).finally(() => { (app as unknown as { _flushed?: boolean })._flushed = true; app.quit() })
})
app.on('window-all-closed', () => app.quit())

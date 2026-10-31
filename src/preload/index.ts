import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH, type PeditApi } from '../shared/ipc'
import type { TextItem } from '../shared/model'

const on = <A extends unknown[]>(ch: string, cb: (...a: A) => void): (() => void) => {
  const h = (_e: unknown, ...a: unknown[]): void => cb(...(a as A))
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

const api: PeditApi = {
  newProject: (dir, name) => ipcRenderer.invoke(CH.newProject, dir, name),
  openProject: (dir) => ipcRenderer.invoke(CH.openProject, dir),
  pickProjectDir: (mode) => ipcRenderer.invoke(CH.pickProjectDir, mode),
  recentProjects: () => ipcRenderer.invoke(CH.recentProjects),
  forgetRecent: (dir) => ipcRenderer.invoke(CH.forgetRecent, dir),
  closeProject: () => ipcRenderer.invoke(CH.closeProject),
  renameProject: (name) => ipcRenderer.invoke(CH.renameProject, name),
  saveProjectCopy: () => ipcRenderer.invoke(CH.saveProjectCopy),
  removeMedia: (id, force) => ipcRenderer.invoke(CH.removeMedia, id, force),
  removeUnusedMedia: () => ipcRenderer.invoke(CH.removeUnusedMedia),
  freezeFrame: (id, at) => ipcRenderer.invoke(CH.freezeFrame, id, at),
  frameImage: (id, ms) => ipcRenderer.invoke(CH.frameImage, id, ms),
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(CH.setSettings, patch),
  onMenu: (cb) => on(CH.menu, cb),
  pickImport: (kind) => ipcRenderer.invoke(CH.pickImport, kind),
  importPaths: (paths) => ipcRenderer.invoke(CH.importPaths, paths),
  relinkMedia: (id) => ipcRenderer.invoke(CH.relinkMedia, id),
  selectMedia: (id) => ipcRenderer.send(CH.selectMedia, id),
  getState: () => ipcRenderer.invoke(CH.getState),
  onState: (cb) => on(CH.state, cb),
  edit: (cmd) => ipcRenderer.invoke(CH.edit, cmd),
  undo: () => ipcRenderer.invoke(CH.undo),
  redo: () => ipcRenderer.invoke(CH.redo),
  acceptDraft: () => ipcRenderer.invoke(CH.acceptDraft),
  rejectDraft: () => ipcRenderer.invoke(CH.rejectDraft),
  onMediaProgress: (cb) => on(CH.mediaProgress, cb),
  pathForFile: (file) => webUtils.getPathForFile(file),
  diagnostics: () => ipcRenderer.invoke(CH.diagnostics),
  sendChat: (text, tags) => ipcRenderer.invoke(CH.sendChat, text, tags),
  stopChat: () => ipcRenderer.send(CH.stopChat),
  onChatEvent: (cb) => on(CH.chatEvent, cb),
  chatHistory: () => ipcRenderer.invoke(CH.chatHistory),
  claudeStatus: () => ipcRenderer.invoke(CH.claudeStatus),
  exportVideo: (o) => ipcRenderer.invoke(CH.exportVideo, o),
  cancelExport: () => ipcRenderer.send(CH.cancelExport),
  onExportProgress: (cb) => on(CH.exportProgress, cb),
  pickExportPath: (name) => ipcRenderer.invoke(CH.pickExportPath, name),
  revealFile: (path) => ipcRenderer.send(CH.revealFile, path),
  onTextRenderRequest: (handler) => on(CH.textRender, async (reqId: number, items: TextItem[], w: number, h: number) => {
    try { ipcRenderer.send(CH.textRendered, reqId, await handler(items, w, h), null) }
    catch (e) { ipcRenderer.send(CH.textRendered, reqId, null, String(e)) }
  })
}

contextBridge.exposeInMainWorld('pedit', api)

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
  onTextRenderRequest: (handler) => on(CH.textRender, async (reqId: number, items: TextItem[], w: number, h: number) => {
    try { ipcRenderer.send(CH.textRendered, reqId, await handler(items, w, h), null) }
    catch (e) { ipcRenderer.send(CH.textRendered, reqId, null, String(e)) }
  })
}

contextBridge.exposeInMainWorld('pedit', api)

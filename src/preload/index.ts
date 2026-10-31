import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH, type PeditApi } from '../shared/ipc'

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
  getProject: () => ipcRenderer.invoke(CH.getProject),
  onProject: (cb) => on(CH.project, cb),
  onMediaProgress: (cb) => on(CH.mediaProgress, cb),
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('pedit', api)

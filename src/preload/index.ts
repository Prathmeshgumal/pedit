import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('pedit', {})

import type { Aspect, ItemId, MediaId, TextItem } from './model'

export interface ExportOptions { aspect: Aspect; resolution: 1080 | 2160; fps: 30 | 60 | 'source'; quality: 'standard' | 'high'; outPath: string }
import type { Command } from './commands'
import type { SessionState } from './session'

export type ProgressStage = 'thumb' | 'filmstrip' | 'waveform' | 'proxy'

export interface PeditApi {
  newProject(dir: string, name: string): Promise<void>
  openProject(dir: string): Promise<void>
  pickProjectDir(mode: 'new' | 'open'): Promise<string | null>
  pickImport(kind?: 'files' | 'folder'): Promise<string[]>
  importPaths(paths: string[]): Promise<void>
  relinkMedia(id: MediaId): Promise<void>
  selectMedia(id: MediaId | null): void
  getState(): Promise<SessionState | null>
  onState(cb: (s: SessionState | null) => void): () => void
  edit(cmd: Command): Promise<{ ok: true; summary: string } | { ok: false; error: string }>
  undo(): Promise<void>
  redo(): Promise<void>
  acceptDraft(): Promise<void>
  rejectDraft(): Promise<void>
  onMediaProgress(cb: (id: MediaId, stage: ProgressStage, pct: number) => void): () => void
  pathForFile(file: File): string
  exportVideo(o: ExportOptions): Promise<{ ok: true } | { ok: false; error: string }>
  cancelExport(): void
  onExportProgress(cb: (pct: number) => void): () => void
  pickExportPath(defaultName: string): Promise<string | null>
  revealFile(path: string): void
  /** Renderer side of main's renderTextPngs: render each text item to PNG bytes. */
  onTextRenderRequest(handler: (items: TextItem[], w: number, h: number) => Promise<Record<ItemId, Uint8Array>>): () => void
}

export const CH = {
  newProject: 'project:new',
  openProject: 'project:open',
  pickProjectDir: 'project:pick',
  pickImport: 'media:pick',
  importPaths: 'media:import',
  relinkMedia: 'media:relink',
  selectMedia: 'media:select',
  getState: 'session:get',
  state: 'session:state',
  edit: 'session:edit',
  undo: 'session:undo',
  redo: 'session:redo',
  acceptDraft: 'session:accept',
  rejectDraft: 'session:reject',
  mediaProgress: 'media:progress',
  textRender: 'text:render',
  exportVideo: 'export:run',
  cancelExport: 'export:cancel',
  exportProgress: 'export:progress',
  pickExportPath: 'export:pick',
  revealFile: 'shell:reveal',
  textRendered: 'text:rendered'
} as const

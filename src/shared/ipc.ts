import type { ItemId, MediaId, TextItem } from './model'
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
  textRendered: 'text:rendered'
} as const

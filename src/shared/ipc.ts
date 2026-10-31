import type { Aspect, ItemId, MediaId, TextItem } from './model'

export interface ExportOptions { aspect: Aspect; resolution: 1080 | 2160; fps: 30 | 60 | 'source'; quality: 'standard' | 'high'; outPath: string }
import type { Command } from './commands'
import type { SessionState } from './session'

export interface ChatEntry { at: string; role: 'user' | 'assistant' | 'step' | 'system'; text: string }
export type ChatEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown }
  | { kind: 'toolResult'; id: string; ok: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; ok: boolean; error?: 'not_installed' | 'not_logged_in' | 'usage_limit' | 'stopped' | 'crashed'; message?: string; usage?: unknown }
export interface ClaudeStatus { ok: boolean; reason?: string; version?: string }
/** Tools that only read; the chat shows them dimmed. */
export const READ_TOOLS: Record<string, string> = { get_timeline: 'looked at the timeline', list_media: 'looked at your media', get_project_settings: 'looked at the settings' }

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
  sendChat(text: string, tags: Array<{ name: string; mediaId: string }>): Promise<void>
  stopChat(): void
  onChatEvent(cb: (e: ChatEvent) => void): () => void
  chatHistory(): Promise<ChatEntry[]>
  claudeStatus(): Promise<ClaudeStatus>
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
  sendChat: 'chat:send',
  stopChat: 'chat:stop',
  chatEvent: 'chat:event',
  chatHistory: 'chat:history',
  claudeStatus: 'claude:status',
  exportVideo: 'export:run',
  cancelExport: 'export:cancel',
  exportProgress: 'export:progress',
  pickExportPath: 'export:pick',
  revealFile: 'shell:reveal',
  textRendered: 'text:rendered'
} as const

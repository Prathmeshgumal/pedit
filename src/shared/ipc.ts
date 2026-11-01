import type { Aspect, ItemId, MediaId, TextItem, TextStyle } from './model'

export interface ExportOptions { aspect: Aspect; resolution: 1080 | 2160; fps: 30 | 60 | 'source'; quality: 'standard' | 'high'; outPath: string }
import type { Command } from './commands'
import type { SessionState } from './session'
import type { FontInfo } from './fonts'
import type { TextPreset } from './textPresets'
import type { FilterPreset } from './filterPresets'
import type { Adjust } from './look'

export interface ChatEntry { at: string; role: 'user' | 'assistant' | 'step' | 'system'; text: string }
export type ChatEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; internal?: true }
  | { kind: 'toolResult'; id: string; ok: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; ok: boolean; error?: 'not_installed' | 'not_logged_in' | 'usage_limit' | 'stopped' | 'crashed'; message?: string; usage?: unknown }
export interface ClaudeStatus { ok: boolean; reason?: string; version?: string }
/** Tools that only read; the chat shows them dimmed. */
export const READ_TOOLS: Record<string, string> = { get_timeline: 'looked at the timeline', list_media: 'looked at your media', get_project_settings: 'looked at the settings', look_at_media: 'looked at a clip', look_at_timeline: 'watched the edit', list_transitions: 'looked at transitions', list_filters: 'looked at filters', list_fonts: 'looked at fonts', list_text_styles: 'looked at text styles', get_story: 'read the story' }

export const CLAUDE_MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable'] as const
export const CLAUDE_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export interface Settings { claudeModel: (typeof CLAUDE_MODELS)[number]; claudeEffort: (typeof CLAUDE_EFFORTS)[number] }

/** A clip pointed at with @name, or a file attached to the message (`attached` = its kind). */
export interface ChatTag { name: string; mediaId: MediaId; attached?: 'photo' | 'video' | 'audio' | 'story' }

export interface RecentProject { dir: string; name: string; openedAt: string; exists: boolean }
/** Window-level things the in-app menu asks the main process to do. */
export type WindowAction = 'quit' | 'toggleFullscreen' | 'devtools'

export type ProgressStage = 'thumb' | 'filmstrip' | 'waveform' | 'proxy'

export interface PeditApi {
  newProject(dir: string, name: string): Promise<void>
  openProject(dir: string): Promise<void>
  pickProjectDir(mode: 'new' | 'open'): Promise<string | null>
  recentProjects(): Promise<RecentProject[]>
  forgetRecent(dir: string): Promise<void>
  closeProject(): Promise<void>
  renameProject(name: string): Promise<void>
  saveProjectCopy(): Promise<string | null>
  removeMedia(id: MediaId, force?: boolean): Promise<{ ok: true } | { ok: false; inUse: number } | { ok: false; error: string }>
  removeUnusedMedia(): Promise<number>
  freezeFrame(itemId: ItemId, atMs: number): Promise<void>
  frameImage(mediaId: MediaId, sourceMs: number): Promise<string>
  getSettings(): Promise<Settings>
  getStory(): Promise<string>
  setStory(text: string): Promise<void>
  /** Font and text-style library (bundled + added by the user or Claude). */
  listFonts(): Promise<FontInfo[]>
  addFont(family: string): Promise<FontInfo>
  pickFontFile(): Promise<FontInfo | null>
  listTextStyles(): Promise<TextPreset[]>
  saveTextStyle(name: string, description: string, style: Partial<TextStyle>): Promise<TextPreset>
  listFilters(): Promise<FilterPreset[]>
  saveFilter(name: string, description: string, adjust: Adjust): Promise<FilterPreset>
  /** Pick a .cube file and make a filter from it (named after the file). */
  pickLut(): Promise<FilterPreset | null>
  /** Fonts, text styles or filters were added (by Claude or in another window). */
  onLibraryChanged(cb: () => void): () => void
  setSettings(patch: Partial<Settings>): Promise<Settings>
  windowAction(a: WindowAction): void
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
  sendChat(text: string, tags: ChatTag[]): Promise<void>
  attachToChat(paths: string[]): Promise<ChatTag[]>
  attachPastedImage(png: Uint8Array): Promise<ChatTag[]>
  stopChat(): void
  onChatEvent(cb: (e: ChatEvent) => void): () => void
  chatHistory(): Promise<ChatEntry[]>
  claudeStatus(): Promise<ClaudeStatus>
  diagnostics(): Promise<{ ffmpeg: string; encoder: string; claude: string | null }>
  /** Renderer side of main's renderTextPngs: render each text item to PNG bytes. */
  onTextRenderRequest(handler: (items: TextItem[], w: number, h: number) => Promise<Record<ItemId, RenderedText>>): () => void
}

/** A text drawn by the renderer for export: full-frame PNG bytes and the text block's centre in px. */
export interface RenderedText { png: Uint8Array; cx: number; cy: number }

export const CH = {
  newProject: 'project:new',
  openProject: 'project:open',
  pickProjectDir: 'project:pick',
  recentProjects: 'project:recent',
  forgetRecent: 'project:forget',
  closeProject: 'project:close',
  renameProject: 'project:rename',
  saveProjectCopy: 'project:copy',
  removeMedia: 'media:remove',
  removeUnusedMedia: 'media:removeUnused',
  freezeFrame: 'edit:freeze',
  frameImage: 'media:frame',
  getSettings: 'settings:get',
  getStory: 'story:get',
  setStory: 'story:set',
  listFonts: 'lib:fonts',
  addFont: 'lib:addFont',
  pickFontFile: 'lib:pickFont',
  listTextStyles: 'lib:textStyles',
  saveTextStyle: 'lib:saveTextStyle',
  libraryChanged: 'lib:changed',
  listFilters: 'lib:filters',
  saveFilter: 'lib:saveFilter',
  pickLut: 'lib:pickLut',
  setSettings: 'settings:set',
  windowAction: 'app:window',
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
  diagnostics: 'app:diagnostics',
  sendChat: 'chat:send',
  attachToChat: 'chat:attach',
  attachPastedImage: 'chat:paste',
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

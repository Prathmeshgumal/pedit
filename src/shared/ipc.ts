import type { MediaId, Project } from './model'

export type ProgressStage = 'thumb' | 'filmstrip' | 'waveform' | 'proxy'

export interface PeditApi {
  newProject(dir: string, name: string): Promise<void>
  openProject(dir: string): Promise<void>
  pickProjectDir(mode: 'new' | 'open'): Promise<string | null>
  pickImport(kind?: 'files' | 'folder'): Promise<string[]>
  importPaths(paths: string[]): Promise<void>
  relinkMedia(id: MediaId): Promise<void>
  selectMedia(id: MediaId | null): void
  getProject(): Promise<Project | null>
  onProject(cb: (p: Project | null) => void): () => void
  onMediaProgress(cb: (id: MediaId, stage: ProgressStage, pct: number) => void): () => void
  pathForFile(file: File): string
}

export const CH = {
  newProject: 'project:new',
  openProject: 'project:open',
  pickProjectDir: 'project:pick',
  pickImport: 'media:pick',
  importPaths: 'media:import',
  relinkMedia: 'media:relink',
  selectMedia: 'media:select',
  getProject: 'project:get',
  project: 'project:state',
  mediaProgress: 'media:progress'
} as const

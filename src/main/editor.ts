import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import type { MediaId, MediaItem, Project } from '../shared/model'
import { applyCommand, type Command } from '../shared/commands'
import { randomIds } from '../shared/ids'
import type { ProgressStage } from '../shared/ipc'
import { ProjectStore } from './project/store'
import { MediaPipeline, importPaths } from './media/jobs'
import { detectEncoders } from './media/ffmpeg'

type Listener = { project(p: Project | null): void; progress(id: MediaId, stage: ProgressStage, pct: number): void }

/** Owns the open project, its store and media pipeline. All project changes go through apply(). */
export class Editor {
  store: ProjectStore | null = null
  private pipeline: MediaPipeline | null = null
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private out: Listener) {}

  get project(): Project | null { return this.store?.project ?? null }

  async newProject(dir: string, name: string): Promise<void> { await this.attach(await ProjectStore.create(dir, name)) }
  async openProject(dir: string): Promise<void> { await this.attach(await ProjectStore.open(dir)) }

  async openOrCreate(dir: string): Promise<void> {
    if (existsSync(`${dir}/project.json`)) await this.openProject(dir)
    else await this.newProject(dir, basename(dir).replace(/\.pedit$/, ''))
  }

  apply(cmd: Command): void {
    if (!this.store) throw new Error('no project open')
    const { project } = applyCommand(this.store.project, cmd, randomIds)
    this.store.project = project
    this.scheduleSave()
    this.out.project(project)
  }

  async importPaths(paths: string[]): Promise<void> {
    const store = this.need()
    const items = await importPaths(paths, store.project.media, randomIds)
    if (!items.length) return
    this.apply({ type: 'addMedia', items })
    for (const m of items) this.pipeline!.enqueue(m)
  }

  async relink(id: MediaId, path: string): Promise<void> {
    const store = this.need()
    await store.relink(id, path)
    this.out.project(store.project)
    const m = store.project.media.find((x) => x.id === id)
    if (m) this.pipeline!.enqueue(m)
  }

  select(id: MediaId | null): void { if (id) this.pipeline?.prioritize([id]) }

  async flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    if (this.store) await this.store.save(this.store.project)
  }

  private need(): ProjectStore {
    if (!this.store) throw new Error('no project open')
    return this.store
  }

  private async attach(store: ProjectStore): Promise<void> {
    await this.flush()
    this.pipeline?.cancelAll()
    this.store = store
    this.pipeline = new MediaPipeline(store.cacheDir, await detectEncoders(),
      (id, patch) => { if (this.store === store) this.apply({ type: 'updateMedia', id, patch }) },
      (id, stage, pct) => this.out.progress(id, stage, pct))
    this.out.project(store.project)
    for (const m of store.project.media) if (needsWork(m)) this.pipeline.enqueue(m)
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.store?.save(this.store.project) }, 300)
  }
}

function needsWork(m: MediaItem): boolean {
  if (m.status === 'offline') return false
  if (m.status !== 'ready') return true
  const paths = [m.thumbPath, m.filmstripPath, m.waveformPath, m.proxyPath].filter(Boolean) as string[]
  return paths.some((p) => !existsSync(p))
}

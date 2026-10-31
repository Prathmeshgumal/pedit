import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import type { MediaId, MediaItem } from '../shared/model'
import type { Command } from '../shared/commands'
import { EditSession, type SessionState, type Source } from '../shared/session'
import type { ProgressStage } from '../shared/ipc'
import { ProjectStore } from './project/store'
import { MediaPipeline, importPaths } from './media/jobs'
import { detectEncoders } from './media/ffmpeg'
import { randomIds } from '../shared/ids'
import { probe } from './media/probe'

type Listener = { state(s: SessionState | null): void; progress(id: MediaId, stage: ProgressStage, pct: number): void }

/** Owns the open project: its store, edit session and media pipeline. */
export class Editor {
  store: ProjectStore | null = null
  session: EditSession | null = null
  private pipeline: MediaPipeline | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private offSession: (() => void) | null = null

  constructor(private out: Listener) {}

  state(): SessionState | null { return this.session?.state() ?? null }

  async newProject(dir: string, name: string): Promise<void> { await this.attach(await ProjectStore.create(dir, name)) }
  async openProject(dir: string): Promise<void> { await this.attach(await ProjectStore.open(dir)) }

  async openOrCreate(dir: string): Promise<void> {
    if (existsSync(`${dir}/project.json`)) await this.openProject(dir)
    else await this.newProject(dir, basename(dir).replace(/\.pedit$/, ''))
  }

  apply(cmd: Command, source: Source = 'user', expectedRevision?: number): string {
    return this.need().session.apply(cmd, source, expectedRevision).summary
  }

  async importPaths(paths: string[]): Promise<void> {
    const { session } = this.need()
    const items = await importPaths(paths, session.state().real.media, randomIds)
    if (!items.length) return
    session.apply({ type: 'addMedia', items }, 'user')
    for (const m of items) this.pipeline!.enqueue(m)
  }

  async relink(id: MediaId, path: string): Promise<void> {
    const { session } = this.need()
    let info: Awaited<ReturnType<typeof probe>>
    try { info = await probe(path) } catch (e) {
      session.apply({ type: 'updateMedia', id, patch: { path, status: 'error', error: `could not read this file: ${(e as Error).message}` } }, 'user')
      return
    }
    session.apply({ type: 'updateMedia', id, patch: { ...info, path, status: 'processing', error: undefined } }, 'user')
    const m = session.state().real.media.find((x) => x.id === id)
    if (m) this.pipeline!.enqueue(m)
  }

  /** Close the open project (after saving) and go back to the start screen. */
  async close(): Promise<void> {
    await this.flush()
    this.pipeline?.cancelAll()
    this.offSession?.()
    this.offSession = null
    this.pipeline = null
    this.store = null
    this.session = null
    this.out.state(null)
  }

  async rename(name: string): Promise<void> {
    const { store, session } = this.need()
    await this.flush()
    await store.rename(name)
    // the session owns the live project: rename it there too so the next save keeps it
    session.renameProject(store.project.name)
  }

  /** Media not used anywhere on the timeline (real or draft). */
  unusedMedia(): MediaId[] {
    const st = this.need().session.state()
    const used = new Set([...st.real.video, ...st.real.audio, ...st.view.video, ...st.view.audio].map((i) => i.mediaId))
    return st.real.media.filter((m) => !used.has(m.id)).map((m) => m.id)
  }

  select(id: MediaId | null): void { if (id) this.pipeline?.prioritize([id]) }

  async flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    if (this.store && this.session) await this.store.save(this.session.state().real)
  }

  private need(): { store: ProjectStore; session: EditSession } {
    if (!this.store || !this.session) throw new Error('no project open')
    return { store: this.store, session: this.session }
  }

  private async attach(store: ProjectStore): Promise<void> {
    await this.flush()
    this.pipeline?.cancelAll()
    this.offSession?.()
    const session = new EditSession(store.project)
    this.store = store
    this.session = session
    this.offSession = session.onChange((s) => { this.scheduleSave(); this.out.state(s) })
    this.pipeline = new MediaPipeline(store.cacheDir, await detectEncoders(),
      (id, patch) => { if (this.session === session) session.apply({ type: 'updateMedia', id, patch }, 'user') },
      (id, stage, pct) => this.out.progress(id, stage, pct))
    this.out.state(session.state())
    for (const m of session.state().real.media) {
      // failed items are read again first: an older pedit may have mis-read them (e.g. photos taken for videos)
      if (m.status === 'error') void this.relink(m.id, m.path).catch(() => {})
      else if (needsWork(m)) this.pipeline.enqueue(m)
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush() }, 300)
  }
}

function needsWork(m: MediaItem): boolean {
  if (m.status === 'offline') return false
  if (m.status !== 'ready') return true
  const paths = [m.thumbPath, m.filmstripPath, m.waveformPath, m.proxyPath].filter(Boolean) as string[]
  return paths.some((p) => !existsSync(p))
}

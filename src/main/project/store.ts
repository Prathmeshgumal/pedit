import { existsSync } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { emptyProject, type MediaId, type Project } from '../../shared/model'
import { applyCommand } from '../../shared/commands'
import { randomIds } from '../../shared/ids'

import type { ChatEntry } from '../../shared/ipc'
export type { ChatEntry } from '../../shared/ipc'

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export class ProjectStore {
  readonly cacheDir: string
  claudeSessionId: string | null = null

  private constructor(readonly dir: string, public project: Project) {
    this.cacheDir = join(dir, 'cache')
  }

  private get projectFile(): string { return join(this.dir, 'project.json') }
  private get chatFile(): string { return join(this.dir, 'chat.jsonl') }
  private get sessionFile(): string { return join(this.dir, 'session.json') }

  static async create(dir: string, name: string): Promise<ProjectStore> {
    await mkdir(join(dir, 'cache'), { recursive: true })
    if (existsSync(join(dir, 'project.json'))) throw new Error(`a project already exists at ${dir}`)
    const s = new ProjectStore(dir, emptyProject(name))
    await s.save(s.project)
    return s
  }

  static async open(dir: string): Promise<ProjectStore> {
    const file = join(dir, 'project.json')
    if (!existsSync(file)) throw new Error(`not a pedit project (no project.json): ${dir}`)
    const project = JSON.parse(await readFile(file, 'utf8')) as Project
    for (const m of project.media) {
      if (!existsSync(m.path)) m.status = 'offline'
      else if (m.status === 'offline') m.status = 'processing'
    }
    const s = new ProjectStore(dir, project)
    await mkdir(s.cacheDir, { recursive: true })
    if (existsSync(s.sessionFile)) {
      try { s.claudeSessionId = (JSON.parse(await readFile(s.sessionFile, 'utf8')) as { claudeSessionId?: string }).claudeSessionId ?? null } catch { /* ignore corrupt */ }
    }
    return s
  }

  async save(p: Project): Promise<void> {
    this.project = p
    await writeAtomic(this.projectFile, JSON.stringify(p, null, 2))
  }

  async appendChat(e: ChatEntry): Promise<void> {
    await appendFile(this.chatFile, JSON.stringify(e) + '\n')
  }

  async readChat(): Promise<ChatEntry[]> {
    if (!existsSync(this.chatFile)) return []
    return (await readFile(this.chatFile, 'utf8')).split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l) as ChatEntry] } catch { return [] }
    })
  }

  async setClaudeSessionId(id: string): Promise<void> {
    this.claudeSessionId = id
    await writeAtomic(this.sessionFile, JSON.stringify({ claudeSessionId: id }))
  }

  async rename(name: string): Promise<void> {
    if (!name.trim()) throw new Error('a project needs a name')
    await this.save({ ...this.project, name: name.trim() })
  }

  /** Copy the edit and chat to a new project folder (no cache, no Claude session); the copy gets its own id. */
  async saveCopy(dest: string): Promise<void> {
    if (existsSync(join(dest, 'project.json'))) throw new Error(`a project already exists at ${dest}`)
    await mkdir(join(dest, 'cache'), { recursive: true })
    const name = basename(dest).replace(/\.pedit$/, '')
    const fresh = emptyProject(name)
    await writeAtomic(join(dest, 'project.json'), JSON.stringify({ ...this.project, id: fresh.id, name, media: this.project.media.map(({ proxyPath, thumbPath, filmstripPath, waveformPath, ...m }) => ({ ...m, status: m.status === 'offline' ? 'offline' : 'processing' })) }, null, 2))
    if (existsSync(this.chatFile)) await copyFile(this.chatFile, join(dest, 'chat.jsonl'))
  }

  async relink(mediaId: MediaId, newPath: string): Promise<void> {
    const { project } = applyCommand(this.project, { type: 'updateMedia', id: mediaId, patch: { path: newPath, status: 'processing', error: undefined } }, randomIds)
    await this.save(project)
  }
}

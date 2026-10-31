import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface RecentProject { dir: string; name: string; openedAt: string; exists: boolean }
const MAX = 12

/** The start screen's "recent projects" list, kept in userData/recent.json. */
export class Recents {
  constructor(private file: string) {}

  private async read(): Promise<Array<Omit<RecentProject, 'exists'>>> {
    try { const v = JSON.parse(await readFile(this.file, 'utf8')) as unknown; return Array.isArray(v) ? v : [] } catch { return [] }
  }

  async list(): Promise<RecentProject[]> {
    return (await this.read()).map((r) => ({ ...r, exists: existsSync(join(r.dir, 'project.json')) }))
  }

  async add(dir: string, name: string): Promise<void> {
    const rest = (await this.read()).filter((r) => r.dir !== dir)
    await writeFile(this.file, JSON.stringify([{ dir, name, openedAt: new Date().toISOString() }, ...rest].slice(0, MAX), null, 2))
  }

  async remove(dir: string): Promise<void> {
    await writeFile(this.file, JSON.stringify((await this.read()).filter((r) => r.dir !== dir), null, 2))
  }
}

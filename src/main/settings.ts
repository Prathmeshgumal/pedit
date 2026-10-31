import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Settings } from '../shared/ipc'
import { CLAUDE_EFFORTS, CLAUDE_MODELS } from '../shared/ipc'

export const DEFAULT_SETTINGS: Settings = { claudeModel: 'default', claudeEffort: 'default' }

/** Keep only known values; anything else becomes the default. */
function clean(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    claudeModel: (CLAUDE_MODELS as readonly unknown[]).includes(o.claudeModel) ? o.claudeModel as Settings['claudeModel'] : 'default',
    claudeEffort: (CLAUDE_EFFORTS as readonly unknown[]).includes(o.claudeEffort) ? o.claudeEffort as Settings['claudeEffort'] : 'default'
  }
}

/** App preferences in userData/settings.json. */
export class SettingsStore {
  private cache: Settings | null = null
  constructor(private file: string) {}

  /** Last loaded settings (defaults before the first get). */
  get current(): Settings { return this.cache ?? DEFAULT_SETTINGS }

  async get(): Promise<Settings> {
    if (!this.cache) {
      try { this.cache = clean(JSON.parse(await readFile(this.file, 'utf8'))) } catch { this.cache = { ...DEFAULT_SETTINGS } }
    }
    return { ...this.cache }
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    const next = clean({ ...(await this.get()), ...patch })
    // a bad value in the patch keeps what was there rather than resetting it
    for (const k of Object.keys(patch) as Array<keyof Settings>) if (next[k] === 'default' && patch[k] !== 'default') (next as unknown as Record<string, string>)[k] = this.current[k]
    this.cache = next
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2))
    await rename(tmp, this.file)
    return { ...next }
  }
}

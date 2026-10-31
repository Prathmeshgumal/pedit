import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BUILTIN_FILTERS, type FilterPreset } from '../../shared/filterPresets'
import { parseCube, type Adjust } from '../../shared/look'

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lut'

/** Built-in filters plus the ones the user or Claude made (userData/filters.json, LUT files in userData/luts). */
export class FilterLibrary {
  constructor(private file: string, private lutDir: string) {}

  private async user(): Promise<FilterPreset[]> {
    try { return (JSON.parse(await readFile(this.file, 'utf8')) as FilterPreset[]).map((p) => ({ ...p, source: 'user' as const })) } catch { return [] }
  }

  async list(): Promise<FilterPreset[]> {
    return [...BUILTIN_FILTERS.map((p) => ({ ...p, source: 'builtin' as const })), ...await this.user()]
  }

  async find(name: string): Promise<FilterPreset | null> {
    const k = name.trim().toLowerCase()
    return (await this.list()).find((p) => p.name.toLowerCase() === k) ?? null
  }

  async save(name: string, description: string, adjust: Adjust, lut?: string): Promise<FilterPreset> {
    const k = name.trim().toLowerCase()
    if (BUILTIN_FILTERS.some((p) => p.name.toLowerCase() === k)) throw new Error(`"${name}" is a built-in filter; pick another name`)
    const entry: FilterPreset = { name: name.trim(), description, adjust, ...(lut ? { lut } : {}) }
    const next = [...(await this.user()).filter((p) => p.name.toLowerCase() !== k).map(({ source: _s, ...p }) => p), entry]
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2))
    await rename(`${this.file}.tmp`, this.file)
    return { ...entry, source: 'user' }
  }

  /** Make a filter from a .cube LUT file (checked, then copied into the library), optionally with adjustments on top. */
  async importCube(name: string, description: string, path: string, adjust: Adjust = {}): Promise<FilterPreset> {
    parseCube(await readFile(path, 'utf8'))
    await mkdir(this.lutDir, { recursive: true })
    const dest = join(this.lutDir, `${slug(name)}-${Date.now().toString(36)}.cube`)
    await copyFile(path, dest)
    return this.save(name, description, adjust, dest)
  }
}

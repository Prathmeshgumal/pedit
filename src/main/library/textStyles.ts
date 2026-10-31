import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TextStyle } from '../../shared/model'
import { BUILTIN_TEXT_PRESETS, type TextPreset } from '../../shared/textPresets'

/** Built-in text looks plus the ones the user or Claude saved (userData/text-styles.json). */
export class TextStyleLibrary {
  constructor(private file: string) {}

  private async user(): Promise<TextPreset[]> {
    try { return (JSON.parse(await readFile(this.file, 'utf8')) as TextPreset[]).map((p) => ({ ...p, source: 'user' as const })) } catch { return [] }
  }

  async list(): Promise<TextPreset[]> {
    return [...BUILTIN_TEXT_PRESETS.map((p) => ({ ...p, source: 'builtin' as const })), ...await this.user()]
  }

  async find(name: string): Promise<TextPreset | null> {
    const k = name.trim().toLowerCase()
    return (await this.list()).find((p) => p.name.toLowerCase() === k) ?? null
  }

  async save(name: string, description: string, style: Partial<TextStyle>): Promise<TextPreset> {
    const k = name.trim().toLowerCase()
    if (BUILTIN_TEXT_PRESETS.some((p) => p.name.toLowerCase() === k)) throw new Error(`"${name}" is a built-in style; pick another name`)
    const entry: TextPreset = { name: name.trim(), description, style }
    const next = [...(await this.user()).filter((p) => p.name.toLowerCase() !== k).map(({ source: _s, ...p }) => p), entry]
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2))
    await rename(`${this.file}.tmp`, this.file)
    return { ...entry, source: 'user' }
  }
}

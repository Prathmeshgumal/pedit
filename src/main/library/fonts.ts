import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { FontInfo } from '../../shared/fonts'

type Manifest = Array<{ family: string; category: string; faces: Record<string, string> }>

async function readManifest(dir: string): Promise<Manifest> {
  try { return JSON.parse(await readFile(join(dir, 'fonts.json'), 'utf8')) as Manifest } catch { return [] }
}

const toInfo = (dir: string, source: FontInfo['source']) => (m: Manifest[number]): FontInfo => ({
  family: m.family, category: m.category, source,
  faces: Object.entries(m.faces).map(([w, f]) => ({ weight: Number(w), path: join(dir, f) })).sort((a, b) => a.weight - b.weight)
})

/** Weights and file urls from a Google Fonts css2 response. */
export function parseGoogleCss(css: string): Array<{ weight: number; url: string }> {
  const out: Array<{ weight: number; url: string }> = []
  for (const block of css.split('@font-face').slice(1)) {
    const w = /font-weight:\s*(\d+)/.exec(block)
    const u = /src:\s*url\(([^)]+)\)/.exec(block)
    if (w && u && !out.some((o) => o.weight === Number(w[1]))) out.push({ weight: Number(w[1]), url: u[1] })
  }
  return out
}

const slug = (family: string): string => family.replace(/[^A-Za-z0-9]+/g, '')

/** Bundled fonts (resources/fonts) plus fonts the user or Claude added (userData/fonts). */
export class FontLibrary {
  constructor(private builtinDir: string, private userDir: string, private fetchFn: typeof fetch = fetch) {}

  async list(): Promise<FontInfo[]> {
    const b = (await readManifest(this.builtinDir)).map(toInfo(this.builtinDir, 'builtin'))
    const u = (await readManifest(this.userDir)).map(toInfo(this.userDir, 'user'))
    return [...b, ...u.filter((x) => !b.some((y) => y.family === x.family))]
  }

  async find(family: string): Promise<FontInfo | null> {
    const k = family.trim().toLowerCase()
    return (await this.list()).find((f) => f.family.toLowerCase() === k) ?? null
  }

  /** Download a Google Font (regular + bold when it has one) into the user library. */
  async addGoogle(family: string): Promise<FontInfo> {
    const have = await this.find(family)
    if (have) return have
    // Google's names are case-sensitive: try what was typed, then Title Case ("bebas neue" → "Bebas Neue")
    const typed = family.trim().replace(/\s+/g, ' ')
    const titled = typed.replace(/\b\w/g, (c) => c.toUpperCase())
    const urls = [...new Set([typed, titled])].flatMap((n) => {
      const q = encodeURIComponent(n).replace(/%20/g, '+')
      return [`https://fonts.googleapis.com/css2?family=${q}:wght@400;700`, `https://fonts.googleapis.com/css2?family=${q}`]
    })
    let faces: Array<{ weight: number; url: string }> = []
    let name = typed
    for (const url of urls) {
      const r = await this.fetchFn(url)
      if (!r.ok) continue
      const css = await r.text()
      faces = parseGoogleCss(css)
      name = /font-family:\s*'([^']+)'/.exec(css)?.[1] ?? name
      if (faces.length) break
    }
    if (!faces.length) throw new Error(`Google Fonts has no font called "${family.trim()}" (check the spelling on fonts.google.com)`)
    await mkdir(this.userDir, { recursive: true })
    const files: Record<string, string> = {}
    for (const f of faces) {
      const r = await this.fetchFn(f.url)
      if (!r.ok) throw new Error(`could not download ${name} ${f.weight}: HTTP ${r.status}`)
      const file = `${slug(name)}-${f.weight}${extname(new URL(f.url).pathname) || '.ttf'}`
      await writeFile(join(this.userDir, file), new Uint8Array(await r.arrayBuffer()))
      files[String(f.weight)] = file
    }
    return this.save({ family: name, category: 'google', faces: files })
  }

  /** Copy a .ttf/.otf/.woff2 the user picked into the library; the family is named after the file. */
  async addFile(path: string): Promise<FontInfo> {
    const ext = extname(path).toLowerCase()
    const family = basename(path, extname(path)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    await mkdir(this.userDir, { recursive: true })
    const file = `${slug(family)}-400${ext}`
    await copyFile(path, join(this.userDir, file))
    return this.save({ family, category: 'custom', faces: { '400': file } })
  }

  private async save(entry: Manifest[number]): Promise<FontInfo> {
    const m = (await readManifest(this.userDir)).filter((x) => x.family !== entry.family)
    m.push(entry)
    const f = join(this.userDir, 'fonts.json')
    await writeFile(`${f}.tmp`, JSON.stringify(m, null, 2))
    await rename(`${f}.tmp`, f)
    return toInfo(this.userDir, 'user')(entry)
  }
}

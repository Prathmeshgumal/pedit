import { FALLBACK_FONTS, type FontInfo } from '@shared/fonts'
import { mediaUrl } from '@shared/mediaUrl'

let list: Promise<FontInfo[]> | null = null
const loading = new Map<string, Promise<boolean>>()
const listeners = new Set<() => void>()

const api = (): { listFonts(): Promise<FontInfo[]>; onLibraryChanged(cb: () => void): () => void } | undefined =>
  (window as unknown as { pedit?: { listFonts(): Promise<FontInfo[]>; onLibraryChanged(cb: () => void): () => void } }).pedit

let subscribed = false
/** Every font in the app library (bundled + added). Refreshed when Claude or the user adds one. */
export function fontList(): Promise<FontInfo[]> {
  const a = api()
  if (!subscribed && a) {
    subscribed = true
    a.onLibraryChanged(() => { list = null; for (const l of listeners) l() })
  }
  list ??= a ? a.listFonts().catch(() => []) : Promise.resolve([])
  return list
}
export function onFontsChanged(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }

async function load(f: FontInfo): Promise<boolean> {
  try {
    for (const face of f.faces) document.fonts.add(await new FontFace(f.family, `url("${mediaUrl(face.path)}")`, { weight: String(face.weight) }).load())
    return true
  } catch { return false }
}

/** Make sure a family (and the fallbacks) can be drawn; returns the CSS font-family list to use. */
export async function ensureFont(family: string): Promise<string> {
  const fonts = await fontList()
  const want = [family, ...FALLBACK_FONTS]
  const ok: string[] = []
  for (const name of want) {
    const f = fonts.find((x) => x.family.toLowerCase() === name.toLowerCase())
    if (!f) continue
    let p = loading.get(f.family)
    if (!p) { p = load(f); loading.set(f.family, p) }
    if (await p && !ok.includes(f.family)) ok.push(f.family)
  }
  return [...ok.map((n) => `"${n}"`), 'sans-serif'].join(', ')
}

/** Load the fallbacks early so the first text draws without waiting. */
export function loadFonts(): Promise<void> { return ensureFont('Inter').then(() => undefined) }

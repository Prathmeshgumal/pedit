import { useEffect, useState } from 'react'
import type { FontInfo } from '@shared/fonts'
import type { TextPreset } from '@shared/textPresets'
import type { FilterPreset } from '@shared/filterPresets'

export interface Library { fonts: FontInfo[]; textStyles: TextPreset[]; filters: FilterPreset[] }
let cache: Library = { fonts: [], textStyles: [], filters: [] }
let loading: Promise<void> | null = null
const subs = new Set<(l: Library) => void>()
let listening = false

function reload(): Promise<void> {
  loading = (async () => {
    const [fonts, textStyles, filters] = await Promise.all([window.pedit.listFonts(), window.pedit.listTextStyles(), window.pedit.listFilters()])
    cache = { fonts, textStyles, filters }
    for (const s of subs) s(cache)
  })().catch(() => {})
  return loading
}

/** Fonts, text styles and filters from the app library; updates when Claude or the user adds one. */
export function useLibrary(): Library {
  const [lib, setLib] = useState(cache)
  useEffect(() => {
    subs.add(setLib)
    if (!listening) { listening = true; window.pedit.onLibraryChanged(() => void reload()) }
    if (!loading) void reload(); else setLib(cache)
    return () => { subs.delete(setLib) }
  }, [])
  return lib
}

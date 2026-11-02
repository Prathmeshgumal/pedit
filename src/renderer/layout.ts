import { create } from 'zustand'

/** The panels whose size the user can drag. Widths and the timeline height are in CSS pixels; null = the default share. */
export type PanelKey = 'media' | 'props' | 'chat' | 'timeline'
export type PanelSizes = Record<PanelKey, number | null>

/**
 * Default sizes as a share of the editor (percent of its width, or of its height for the timeline), used until
 * the user drags a border. Picked by hand on a 2655×1425 window: media 308px, properties 316px, chat 363px,
 * timeline 378px. On smaller windows a panel never goes below its MIN_SIZE.
 */
export const DEFAULT_SHARE: Record<PanelKey, number> = { media: 11.65, props: 11.95, chat: 13.75, timeline: 26.75 }
/** The smallest each panel can be dragged to. The preview and the top row keep at least PREVIEW_MIN / MAIN_MIN. */
export const MIN_SIZE: Record<PanelKey, number> = { media: 160, props: 200, chat: 280, timeline: 120 }
export const PREVIEW_MIN = 280
export const MAIN_MIN = 180

interface Saved { sizes: PanelSizes; chatOpen: boolean }
const KEY = 'pedit.layout.v1'
const EMPTY: PanelSizes = { media: null, props: null, chat: null, timeline: null }

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    if (s && typeof s === 'object') {
      const sizes = { ...EMPTY }
      for (const k of Object.keys(EMPTY) as PanelKey[]) { const v = s.sizes?.[k]; sizes[k] = typeof v === 'number' && v > 0 ? v : null }
      return { sizes, chatOpen: s.chatOpen !== false }
    }
  } catch { /* storage unavailable: use defaults */ }
  return { sizes: { ...EMPTY }, chatOpen: true }
}

function save(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* not critical */ }
}

interface LayoutState extends Saved {
  setSize(k: PanelKey, px: number | null): void
  setChatOpen(open: boolean): void
  toggleChat(): void
  reset(): void
}

export const useLayout = create<LayoutState>((set, get) => {
  const persist = (): void => { const { sizes, chatOpen } = get(); save({ sizes, chatOpen }) }
  return {
    ...load(),
    setSize: (k, px) => { set((s) => ({ sizes: { ...s.sizes, [k]: px === null ? null : Math.round(px) } })); persist() },
    setChatOpen: (open) => { set({ chatOpen: open }); persist() },
    toggleChat: () => { set((s) => ({ chatOpen: !s.chatOpen })); persist() },
    reset: () => { set({ sizes: { ...EMPTY }, chatOpen: true }); persist() }
  }
})

const track = (k: PanelKey, sizes: PanelSizes): string => (sizes[k] === null ? `max(${MIN_SIZE[k]}px, ${DEFAULT_SHARE[k]}%)` : `${sizes[k]}px`)

/** True when the layout is the default one (no dragged sizes, chat open): the reset button has nothing to do. */
export const isDefaultLayout = (sizes: PanelSizes, chatOpen: boolean): boolean => chatOpen && Object.values(sizes).every((v) => v === null)

/** CSS grid tracks for the editor: panels with 6px drag gutters between them. */
export function gridTemplate(sizes: PanelSizes, chatOpen: boolean): { columns: string; rows: string } {
  const cols = [track('media', sizes), '6px', `minmax(${PREVIEW_MIN}px, 1fr)`, '6px', track('props', sizes)]
  if (chatOpen) cols.push('6px', track('chat', sizes))
  return { columns: cols.join(' '), rows: `auto 6px minmax(${MAIN_MIN}px, 1fr) 6px ${track('timeline', sizes)}` }
}

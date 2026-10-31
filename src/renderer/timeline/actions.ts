import type { Project } from '@shared/model'
import { IDENTITY_TRANSFORM } from '@shared/model'
import { edit, useUi } from '../store'
import { getPlayer } from '../preview/instance'
import { splitTarget } from './interact'
import { itemSpans } from './layout'

/** Timeline actions shared by the toolbar, the keyboard and right-click menus. */
export const playheadMs = (): number => { const p = getPlayer(); return p?.mode === 'timeline' ? Math.round(p.timeMs) : 0 }
const view = (): Project | null => useUi.getState().session?.view ?? null

export function selectedClip(p: Project | null = view()): Project['video'][number] | null {
  const id = useUi.getState().selectedItemId
  return p?.video.find((v) => v.id === id) ?? null
}

/** The item the playhead-based tools (split, delete left/right) act on. */
export function playheadTarget(p: Project | null = view(), t = playheadMs()): string | null {
  return p ? splitTarget(p, useUi.getState().selectedItemId, t) : null
}

export function canAct(p: Project | null, sel: string | null, t: number): { split: boolean; del: boolean; clip: boolean } {
  return {
    split: !!p && !!splitTarget(p, sel, t),
    del: !!p && !!sel && itemSpans(p).some((s) => s.id === sel),
    clip: !!p && !!sel && p.video.some((v) => v.id === sel)
  }
}

export function splitAtPlayhead(): void {
  const t = playheadMs(), id = playheadTarget(view(), t)
  if (id) void edit({ type: 'splitItem', id, atMs: t })
}

export function deleteSide(side: 'left' | 'right'): void {
  const t = playheadMs(), id = playheadTarget(view(), t)
  if (id) void edit({ type: 'trimToPlayhead', id, atMs: t, side })
}

export function deleteSelected(): void {
  const s = useUi.getState()
  if (!s.selectedItemId) return
  void edit({ type: 'removeItem', id: s.selectedItemId }); s.selectItem(null)
}

export function rotateSelected(): void {
  const c = selectedClip()
  if (c) void edit({ type: 'setTransform', id: c.id, transform: { rotate: ((((c.transform ?? IDENTITY_TRANSFORM).rotate + 90) % 360) as 0 | 90 | 180 | 270) } })
}

export function mirrorSelected(): void {
  const c = selectedClip()
  if (c) void edit({ type: 'setTransform', id: c.id, transform: { flipH: !(c.transform ?? IDENTITY_TRANSFORM).flipH } })
}

import { IDENTITY_TRANSFORM, type Project } from '@shared/model'
import { DEFAULT_TRANSITION_MS, TRANSITIONS, transitionMs } from '@shared/transitions'
import type { Command } from '@shared/commands'
import { edit, useUi } from '../store'
import type { MenuItem } from '../ContextMenu'
import { deleteSelected, mirrorSelected, playheadMs, rotateSelected, splitAtPlayhead } from './actions'

type Copied = { kind: 'video' | 'text'; cmd: (after: { id: string; endMs: number }) => Command }
let copied: Copied | null = null

export async function freezeAtPlayhead(id: string): Promise<void> {
  try { await window.pedit.freezeFrame(id, playheadMs()) } catch (e) { useUi.getState().showToast(`Freeze frame failed: ${(e as Error).message}`) }
}

/** The right-click menu for a timeline item (video clip, audio item or text). */
export function itemMenu(p: Project, id: string, openCrop: (id: string) => void): MenuItem[] {
  const ui = useUi.getState()
  const v = p.video.find((x) => x.id === id), a = p.audio.find((x) => x.id === id), t = p.text.find((x) => x.id === id)
  const common: MenuItem[] = [
    { label: 'Split', onClick: splitAtPlayhead },
    { label: 'Delete', danger: true, onClick: deleteSelected },
    { label: 'Duplicate', onClick: () => void edit({ type: 'duplicateItem', id }) }
  ]
  if (t) {
    return [...common,
      { label: 'Copy', onClick: () => { copied = { kind: 'text', cmd: (after) => ({ type: 'addText', text: t.text, startMs: after.endMs, durationMs: t.durationMs, style: t.style }) } } },
      { label: 'Paste after', disabled: copied?.kind !== 'text', onClick: () => { if (copied?.kind === 'text') void edit(copied.cmd({ id, endMs: t.startMs + t.durationMs })) } },
      { label: 'Edit text', onClick: () => { ui.selectItem(id); setTimeout(() => (document.querySelector('[data-testid=prop-text]') as HTMLElement | null)?.focus(), 0) } }]
  }
  if (a) {
    return [...common,
      { label: a.volume === 0 ? 'Unmute' : 'Mute', onClick: () => void edit({ type: 'setVolume', id, volume: a.volume === 0 ? 1 : 0 }) }]
  }
  if (!v) return []
  const m = p.media.find((x) => x.id === v.mediaId)
  const end = v.startMs + v.outMs - v.inMs
  const tr = v.transform ?? IDENTITY_TRANSFORM
  const replaceWith = ui.selectedMediaId && ui.selectedMediaId !== v.mediaId ? p.media.find((x) => x.id === ui.selectedMediaId) : undefined
  return [...common,
    { label: 'Copy', onClick: () => { copied = { kind: 'video', cmd: (after) => ({ type: 'addClip', mediaId: v.mediaId, inMs: v.inMs, outMs: v.outMs, after: after.id }) } } },
    { label: 'Paste after', disabled: copied?.kind !== 'video', onClick: () => { if (copied?.kind === 'video') void edit(copied.cmd({ id, endMs: end })) } },
    { label: replaceWith ? `Replace with ${replaceWith.name}` : 'Replace with selected media', disabled: !replaceWith || replaceWith.kind === 'audio',
      onClick: () => { if (replaceWith) void edit({ type: 'replaceClip', id, mediaId: replaceWith.id }) } },
    ...(m?.kind === 'video' && m.hasAudio ? [{ label: 'Extract audio', onClick: () => void edit({ type: 'extractAudio', id }) }] : []),
    { label: v.volume === 0 ? 'Unmute' : 'Mute', onClick: () => void edit({ type: 'setVolume', id, volume: v.volume === 0 ? 1 : 0 }) },
    { label: 'Freeze frame', onClick: () => void freezeAtPlayhead(id) },
    { label: 'Rotate 90°', onClick: rotateSelected },
    { label: tr.flipH ? 'Unmirror' : 'Mirror', onClick: mirrorSelected },
    { label: 'Crop…', onClick: () => openCrop(id) },
    { label: 'Reset framing', disabled: !v.transform, onClick: () => void edit({ type: 'setTransform', id, transform: IDENTITY_TRANSFORM }) }
  ]
}


/** The menu of a cut's button: pick the transition into clip `id`, its length, or use it on every cut. */
export function transitionMenu(p: Project, id: string): MenuItem[] {
  const i = p.video.findIndex((v) => v.id === id)
  const cur = p.video[i]?.transition
  const ms = cur?.durationMs ?? DEFAULT_TRANSITION_MS
  const real = cur ? transitionMs(p.video, i) : 0
  const tick = (on: boolean, label: string): string => `${on ? '✓ ' : '\u2003'}${label}`
  return [
    { label: tick(!cur, 'No transition (cut)'), onClick: () => void edit({ type: 'setTransition', ids: [id], transition: null }) },
    ...TRANSITIONS.map((t, k): MenuItem => ({ label: tick(cur?.type === t.id, t.label), hint: t.hint || undefined, sep: k === 0,
      onClick: () => void edit({ type: 'setTransition', ids: [id], transition: { type: t.id, durationMs: ms } }) })),
    ...[300, 500, 1000, 2000].map((d, k): MenuItem => ({ label: tick(!!cur && cur.durationMs === d, `Length ${d / 1000} s`), sep: k === 0, disabled: !cur,
      onClick: () => { if (cur) void edit({ type: 'setTransition', ids: [id], transition: { type: cur.type, durationMs: d } }) } })),
    ...(cur && real < cur.durationMs ? [{ label: `\u2003(shortened to ${(real / 1000).toFixed(1)} s by the clip lengths)`, disabled: true, onClick: () => {} }] : []),
    { label: 'Use on every cut', sep: true, disabled: !cur, onClick: () => { if (cur) void edit({ type: 'setTransition', ids: 'all', transition: cur }) } }
  ]
}

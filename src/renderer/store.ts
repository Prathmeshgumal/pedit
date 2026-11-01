import { create } from 'zustand'
import type { ItemId, MediaId, Project } from '@shared/model'
import type { ProgressStage } from '@shared/ipc'
import type { SessionState } from '@shared/session'

export interface Progress { stage: ProgressStage; pct: number }

interface UiState {
  project: Project | null
  session: SessionState | null
  loaded: boolean
  progress: Record<MediaId, Progress>
  selectedMediaId: MediaId | null
  selectedItemId: ItemId | null
  clipPreviewId: MediaId | null
  toast: string | null
  chatRunning: boolean
  snapping: boolean
  setSnapping(v: boolean): void
  /** Timeline pointer tool: select/move, or blade (click a clip to cut it there). */
  tool: 'select' | 'blade'
  setTool(t: 'select' | 'blade'): void
  setChatRunning(v: boolean): void
  selectItem(id: ItemId | null): void
  previewClip(id: MediaId | null): void
  showToast(msg: string): void
  setSession(s: SessionState | null): void
  setProgress(id: MediaId, stage: ProgressStage, pct: number): void
  selectMedia(id: MediaId | null): void
}

export const useUi = create<UiState>((set) => ({
  project: null,
  session: null,
  loaded: false,
  progress: {},
  selectedMediaId: null,
  selectedItemId: null,
  clipPreviewId: null,
  toast: null,
  chatRunning: false,
  snapping: true,
  setSnapping: (snapping) => set({ snapping }),
  tool: 'select',
  setTool: (tool) => set({ tool }),
  setChatRunning: (chatRunning) => set({ chatRunning }),
  selectItem: (selectedItemId) => set({ selectedItemId }),
  previewClip: (clipPreviewId) => set({ clipPreviewId }),
  showToast: (toast) => { set({ toast }); setTimeout(() => { if (useUi.getState().toast === toast) set({ toast: null }) }, 1500) },
  setSession: (session) => set({ session, project: session?.view ?? null, loaded: true }),
  setProgress: (id, stage, pct) => set((s) => ({ progress: { ...s.progress, [id]: { stage, pct } } })),
  selectMedia: (id) => { window.pedit.selectMedia(id); set({ selectedMediaId: id }) }
}))

export function connectStore(): void {
  const s = useUi.getState()
  window.pedit.onState((st) => s.setSession(st))
  window.pedit.onMediaProgress((id, stage, pct) => useUi.getState().setProgress(id, stage, pct))
  void window.pedit.getState().then((st) => { if (!useUi.getState().loaded || st) s.setSession(st) })
}

export const fmtDur = (ms: number): string => {
  const s = Math.round(ms / 100) / 10
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

/** Send an edit; surface errors as a toast. */
export async function edit(cmd: Parameters<typeof window.pedit.edit>[0]): Promise<boolean> {
  const r = await window.pedit.edit(cmd)
  if (!r.ok) useUi.getState().showToast(r.error)
  return r.ok
}

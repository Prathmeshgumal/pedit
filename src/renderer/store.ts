import { create } from 'zustand'
import type { MediaId, Project } from '@shared/model'
import type { ProgressStage } from '@shared/ipc'
import type { SessionState } from '@shared/session'

export interface Progress { stage: ProgressStage; pct: number }

interface UiState {
  project: Project | null
  session: SessionState | null
  loaded: boolean
  progress: Record<MediaId, Progress>
  selectedMediaId: MediaId | null
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

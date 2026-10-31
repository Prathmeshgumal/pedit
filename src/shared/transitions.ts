import type { VideoItem } from './model'

/** Transition types; the id is ffmpeg's xfade name, and the preview implements the same formula. */
export const TRANSITIONS = [
  { id: 'fade', label: 'Cross dissolve', hint: 'soft blend; the safe default' },
  { id: 'fadeblack', label: 'Dip to black', hint: 'end of a scene, time passing' },
  { id: 'fadewhite', label: 'Dip to white', hint: 'flash, memory, dream' },
  { id: 'smoothleft', label: 'Soft wipe left', hint: 'gentle directional move' },
  { id: 'smoothright', label: 'Soft wipe right', hint: '' },
  { id: 'smoothup', label: 'Soft wipe up', hint: '' },
  { id: 'smoothdown', label: 'Soft wipe down', hint: '' },
  { id: 'wipeleft', label: 'Wipe left', hint: 'hard edge wipe' },
  { id: 'wiperight', label: 'Wipe right', hint: '' },
  { id: 'wipeup', label: 'Wipe up', hint: '' },
  { id: 'wipedown', label: 'Wipe down', hint: '' },
  { id: 'slideleft', label: 'Slide left', hint: 'next clip pushes in; energetic' },
  { id: 'slideright', label: 'Slide right', hint: '' },
  { id: 'slideup', label: 'Slide up', hint: '' },
  { id: 'slidedown', label: 'Slide down', hint: '' },
  { id: 'circleopen', label: 'Circle open', hint: 'playful reveal from the centre' },
  { id: 'circleclose', label: 'Circle close', hint: '' },
  { id: 'zoomin', label: 'Zoom in', hint: 'punch into the next shot' }
] as const

export type TransitionType = typeof TRANSITIONS[number]['id']
export const TRANSITION_IDS = TRANSITIONS.map((t) => t.id) as unknown as readonly [TransitionType, ...TransitionType[]]
/** Program ids the preview shader switches on. */
export const transitionIndex = (t: TransitionType): number => TRANSITION_IDS.indexOf(t)

export const DEFAULT_TRANSITION_MS = 500
export const MIN_TRANSITION_MS = 100

const len = (v: VideoItem): number => v.outMs - v.inMs

/** How long the transition into clip i really is: at most half of either clip, so a clip never overlaps two others. */
export function transitionMs(video: VideoItem[], i: number): number {
  const v = video[i], prev = video[i - 1]
  if (!v?.transition || !prev) return 0
  const d = Math.min(v.transition.durationMs, Math.floor(len(prev) / 2), Math.floor(len(v) / 2))
  return d >= MIN_TRANSITION_MS ? d : 0
}

import type { ItemId, MediaId, Project, VideoItem } from './model'
import { transitionMs } from './transitions'

/** One clip's sound on the timeline. Clips alternate between two lanes so neighbours can overlap (transitions, J/L cuts). */
export interface ClipAudioSeg { itemId: ItemId; mediaId: MediaId; lane: 0 | 1; startMs: number; inMs: number; outMs: number; gain: number; fadeInMs: number; fadeOutMs: number }

/** Tiny fade at an audio edit that is not under a transition, so it doesn't click. */
export const EDGE_FADE_MS = 30

const len = (v: VideoItem): number => v.outMs - v.inMs

/**
 * The audio edit offset at the cut into clip i: + = L-cut (the previous clip's sound runs on over this picture),
 * − = J-cut (this clip's sound starts before its picture). Limited to half the shorter clip (minus any transition)
 * and to what the source files have.
 */
export function audioCutAt(p: Project, i: number): number {
  const v = p.video[i], prev = p.video[i - 1]
  if (!v?.audioCutMs || !prev) return 0
  const d = transitionMs(p.video, i)
  const lim = Math.max(0, Math.floor(Math.min(len(prev), len(v)) / 2) - d)
  let o = Math.max(-lim, Math.min(lim, v.audioCutMs))
  if (o > 0) { const dur = p.media.find((m) => m.id === prev.mediaId)?.durationMs ?? prev.outMs; o = Math.min(o, Math.max(0, dur - prev.outMs)) }
  if (o < 0) o = Math.max(o, -v.inMs)
  return o
}

/** Every video clip's own sound: where it plays, which part of the source, and its fades. Used by preview and export. */
export function clipAudioSegments(p: Project): ClipAudioSeg[] {
  const media = new Map(p.media.map((m) => [m.id, m]))
  const out: ClipAudioSeg[] = []
  p.video.forEach((v, i) => {
    const m = media.get(v.mediaId)
    if (!m || m.kind !== 'video' || !m.hasAudio || v.volume <= 0) return
    const oIn = audioCutAt(p, i), oOut = audioCutAt(p, i + 1)
    const dIn = transitionMs(p.video, i), dOut = transitionMs(p.video, i + 1)
    out.push({
      itemId: v.id, mediaId: v.mediaId, lane: (i % 2) as 0 | 1,
      startMs: v.startMs + oIn, inMs: v.inMs + oIn, outMs: v.outMs + oOut, gain: v.volume,
      fadeInMs: dIn || (oIn ? EDGE_FADE_MS : 0), fadeOutMs: dOut || (oOut ? EDGE_FADE_MS : 0)
    })
  })
  return out
}

/** 0..1 loudness of a segment at timeline time ms (linear fades). */
export function envelopeAt(s: Pick<ClipAudioSeg, 'startMs' | 'inMs' | 'outMs' | 'fadeInMs' | 'fadeOutMs'>, ms: number): number {
  const end = s.startMs + s.outMs - s.inMs
  if (ms <= s.startMs || ms >= end) return 0
  const a = s.fadeInMs ? Math.min(1, (ms - s.startMs) / s.fadeInMs) : 1
  const b = s.fadeOutMs ? Math.min(1, (end - ms) / s.fadeOutMs) : 1
  return Math.min(a, b)
}

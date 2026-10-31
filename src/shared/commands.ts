import { ASPECT_SIZE, DEFAULT_TEXT_STYLE, MIN_ITEM_MS, type Aspect, type AudioItem, type ItemId, type MediaId, type MediaItem,
  type Project, type TextItem, type TextStyle, type VideoItem } from './model'
import type { IdGen } from './ids'
import { fmtTime } from './time'

export type Command =
  | { type: 'addMedia'; items: MediaItem[] }
  | { type: 'updateMedia'; id: MediaId; patch: Partial<MediaItem> }
  | { type: 'addClip'; mediaId: MediaId; inMs?: number; outMs?: number; after?: ItemId | null; atMs?: number }
  | { type: 'removeItem'; id: ItemId }
  | { type: 'moveItem'; id: ItemId; after?: ItemId | null; toMs?: number }
  | { type: 'trimItem'; id: ItemId; inMs?: number; outMs?: number }
  | { type: 'splitItem'; id: ItemId; atMs: number }
  | { type: 'addText'; text: string; startMs: number; durationMs: number; style?: Partial<TextStyle> }
  | { type: 'updateText'; id: ItemId; text?: string; startMs?: number; durationMs?: number; style?: Partial<TextStyle> }
  | { type: 'setMusic'; mediaId: MediaId; inMs?: number; volume?: number }
  | { type: 'setVolume'; id: ItemId; volume: number }
  | { type: 'setFormat'; aspect: Aspect }

export type CommandErrorCode = 'not_found' | 'overlap' | 'invalid' | 'media_not_found'

export class CommandError extends Error {
  constructor(public code: CommandErrorCode, message: string) {
    super(message)
    this.name = 'CommandError'
  }
}

export interface CommandResult { project: Project; summary: string; affected: ItemId[] }

const fail = (code: CommandErrorCode, msg: string): never => { throw new CommandError(code, msg) }
const dur = (i: { inMs: number; outMs: number }): number => i.outMs - i.inMs
const int = (n: number): number => Math.round(n)

/** Recompute video start times (ripple: no gaps). */
function ripple(video: VideoItem[]): void {
  let t = 0
  for (const v of video) { v.startMs = t; t += dur(v) }
}

function findMedia(p: Project, id: MediaId): MediaItem {
  return p.media.find((m) => m.id === id) ?? fail('media_not_found', `media ${id} not found`)
}

function locate(p: Project, id: ItemId): { track: 'video' | 'text' | 'audio'; index: number } {
  for (const track of ['video', 'text', 'audio'] as const) {
    const index = (p[track] as Array<{ id: ItemId }>).findIndex((x) => x.id === id)
    if (index >= 0) return { track, index }
  }
  return fail('not_found', `item ${id} not found`)
}

function itemName(p: Project, id: ItemId): string {
  const v = p.video.find((x) => x.id === id) ?? p.audio.find((x) => x.id === id)
  if (v) return `${id} (${p.media.find((m) => m.id === v.mediaId)?.name ?? v.mediaId})`
  const t = p.text.find((x) => x.id === id)
  return t ? `${id} ("${t.text}")` : id
}

/** Insert index for a new/moved video item. */
function insertIndex(video: VideoItem[], after: ItemId | null | undefined, atMs: number | undefined): number {
  if (after === null) return 0
  if (after !== undefined) {
    const i = video.findIndex((v) => v.id === after)
    if (i < 0) fail('not_found', `item ${after} not found`)
    return i + 1
  }
  if (atMs !== undefined) {
    let best = 0
    let bestDist = Infinity
    let t = 0
    for (let i = 0; i <= video.length; i++) {
      const d = Math.abs(atMs - t)
      if (d < bestDist) { bestDist = d; best = i }
      if (i < video.length) t += dur(video[i])
    }
    return best
  }
  return video.length
}

function assertNoOverlap(items: Array<{ id: ItemId; startMs: number; end: number }>, track: string): void {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMs < sorted[i - 1].end) fail('overlap', `${sorted[i].id} overlaps ${sorted[i - 1].id} on the ${track} track`)
  }
}

const textSpans = (t: TextItem[]): Array<{ id: ItemId; startMs: number; end: number }> => t.map((x) => ({ id: x.id, startMs: x.startMs, end: x.startMs + x.durationMs }))
const audioSpans = (a: AudioItem[]): Array<{ id: ItemId; startMs: number; end: number }> => a.map((x) => ({ id: x.id, startMs: x.startMs, end: x.startMs + dur(x) }))

function clampTrim(item: { inMs: number; outMs: number }, media: MediaItem, inMs?: number, outMs?: number): { inMs: number; outMs: number } {
  const i = int(Math.max(0, Math.min(inMs ?? item.inMs, media.durationMs)))
  const o = int(Math.max(0, Math.min(outMs ?? item.outMs, media.durationMs)))
  if (o - i < MIN_ITEM_MS) fail('invalid', `resulting length ${o - i}ms is shorter than ${MIN_ITEM_MS}ms`)
  return { inMs: i, outMs: o }
}

/** Pure: returns a new project, never mutates `p`, never changes `revision`. */
export function applyCommand(p: Project, cmd: Command, ids: IdGen): CommandResult {
  const n = structuredClone(p)
  const done = (summary: string, affected: ItemId[]): CommandResult => ({ project: n, summary, affected })

  switch (cmd.type) {
    case 'addMedia':
      n.media.push(...structuredClone(cmd.items))
      return done(`added ${cmd.items.length} media`, cmd.items.map((m) => m.id))

    case 'updateMedia': {
      const i = n.media.findIndex((m) => m.id === cmd.id)
      if (i < 0) fail('not_found', `media ${cmd.id} not found`)
      n.media[i] = { ...n.media[i], ...structuredClone(cmd.patch), id: cmd.id }
      return done(`updated ${cmd.id}`, [cmd.id])
    }

    case 'addClip': {
      const m = findMedia(n, cmd.mediaId)
      if (m.kind === 'audio') fail('invalid', `${m.name} has no video; use setMusic for audio`)
      const span = clampTrim({ inMs: 0, outMs: m.durationMs }, m, cmd.inMs, cmd.outMs)
      const item: VideoItem = { id: ids('c'), mediaId: m.id, startMs: 0, ...span, volume: 1 }
      n.video.splice(insertIndex(n.video, cmd.after, cmd.atMs), 0, item)
      ripple(n.video)
      return done(`added ${item.id} (${m.name}) at ${fmtTime(item.startMs)}, length ${fmtTime(dur(item))}`, [item.id])
    }

    case 'removeItem': {
      const name = itemName(n, cmd.id)
      const { track, index } = locate(n, cmd.id)
      ;(n[track] as unknown[]).splice(index, 1)
      if (track === 'video') ripple(n.video)
      return done(`removed ${name}`, [cmd.id])
    }

    case 'moveItem': {
      const { track, index } = locate(n, cmd.id)
      if (track === 'video') {
        if (cmd.after === cmd.id) fail('invalid', 'cannot move an item after itself')
        const [item] = n.video.splice(index, 1)
        n.video.splice(insertIndex(n.video, cmd.after, cmd.toMs), 0, item)
        ripple(n.video)
        return done(`moved ${itemName(n, cmd.id)} to ${fmtTime(item.startMs)}`, [cmd.id])
      }
      if (cmd.toMs === undefined) fail('invalid', 'text and music items move with toMs')
      const to = int(Math.max(0, cmd.toMs!))
      if (track === 'text') { n.text[index].startMs = to; assertNoOverlap(textSpans(n.text), 'text') }
      else { n.audio[index].startMs = to; assertNoOverlap(audioSpans(n.audio), 'music') }
      return done(`moved ${itemName(n, cmd.id)} to ${fmtTime(to)}`, [cmd.id])
    }

    case 'trimItem': {
      const { track, index } = locate(n, cmd.id)
      if (track === 'text') fail('invalid', 'use updateText to change text timing')
      const item = n[track][index] as VideoItem | AudioItem
      const was = dur(item)
      Object.assign(item, clampTrim(item, findMedia(n, item.mediaId), cmd.inMs, cmd.outMs))
      if (track === 'video') ripple(n.video)
      else assertNoOverlap(audioSpans(n.audio), 'music')
      return done(`trimmed ${itemName(n, cmd.id)} to ${fmtTime(dur(item))} (was ${fmtTime(was)})`, [cmd.id])
    }

    case 'splitItem': {
      const { track, index } = locate(n, cmd.id)
      const at = int(cmd.atMs)
      if (track === 'text') {
        const t = n.text[index]
        const cut = at - t.startMs
        if (cut < MIN_ITEM_MS || t.durationMs - cut < MIN_ITEM_MS) fail('invalid', `split point ${fmtTime(at)} is not inside ${cmd.id}`)
        const second: TextItem = { ...structuredClone(t), id: ids('t'), startMs: at, durationMs: t.durationMs - cut }
        t.durationMs = cut
        n.text.splice(index + 1, 0, second)
        return done(`split ${itemName(n, cmd.id)} at ${fmtTime(at)} into ${cmd.id} and ${second.id}`, [cmd.id, second.id])
      }
      const item = n[track][index] as VideoItem | AudioItem
      const cut = at - item.startMs
      if (cut < MIN_ITEM_MS || dur(item) - cut < MIN_ITEM_MS) fail('invalid', `split point ${fmtTime(at)} is not inside ${cmd.id}`)
      const second = { ...structuredClone(item), id: ids(track === 'video' ? 'c' : 'a'), startMs: at, inMs: item.inMs + cut }
      item.outMs = item.inMs + cut
      ;(n[track] as Array<VideoItem | AudioItem>).splice(index + 1, 0, second)
      if (track === 'video') ripple(n.video)
      return done(`split ${itemName(n, cmd.id)} at ${fmtTime(at)} into ${cmd.id} and ${second.id}`, [cmd.id, second.id])
    }

    case 'addText': {
      if (!cmd.text.trim()) fail('invalid', 'text is empty')
      if (cmd.durationMs < MIN_ITEM_MS) fail('invalid', `text must last at least ${MIN_ITEM_MS}ms`)
      const t: TextItem = { id: ids('t'), startMs: int(Math.max(0, cmd.startMs)), durationMs: int(cmd.durationMs), text: cmd.text, style: { ...DEFAULT_TEXT_STYLE, ...cmd.style } }
      n.text.push(t)
      n.text.sort((a, b) => a.startMs - b.startMs)
      assertNoOverlap(textSpans(n.text), 'text')
      return done(`added text ${t.id} "${t.text}" at ${fmtTime(t.startMs)} for ${fmtTime(t.durationMs)}`, [t.id])
    }

    case 'updateText': {
      const { track, index } = locate(n, cmd.id)
      if (track !== 'text') fail('invalid', `${cmd.id} is not a text item`)
      const t = n.text[index]
      if (cmd.text !== undefined) { if (!cmd.text.trim()) fail('invalid', 'text is empty'); t.text = cmd.text }
      if (cmd.startMs !== undefined) t.startMs = int(Math.max(0, cmd.startMs))
      if (cmd.durationMs !== undefined) { if (cmd.durationMs < MIN_ITEM_MS) fail('invalid', 'text too short'); t.durationMs = int(cmd.durationMs) }
      if (cmd.style) t.style = { ...t.style, ...cmd.style }
      n.text.sort((a, b) => a.startMs - b.startMs)
      assertNoOverlap(textSpans(n.text), 'text')
      return done(`updated text ${itemName(n, cmd.id)}`, [cmd.id])
    }

    case 'setMusic': {
      const m = findMedia(n, cmd.mediaId)
      if (!m.hasAudio) fail('invalid', `${m.name} has no audio`)
      const volume = cmd.volume ?? 1
      if (volume < 0 || volume > 2) fail('invalid', 'volume must be between 0 and 2')
      const inMs = int(Math.max(0, Math.min(cmd.inMs ?? 0, m.durationMs - MIN_ITEM_MS)))
      const a: AudioItem = { id: ids('a'), mediaId: m.id, startMs: 0, inMs, outMs: m.durationMs, volume }
      n.audio = [a]
      return done(`set music ${a.id} to ${m.name} from ${fmtTime(inMs)} at ${Math.round(volume * 100)}%`, [a.id])
    }

    case 'setVolume': {
      if (cmd.volume < 0 || cmd.volume > 2) fail('invalid', 'volume must be between 0 and 2')
      const { track, index } = locate(n, cmd.id)
      if (track === 'text') fail('invalid', 'text has no volume')
      ;(n[track][index] as VideoItem | AudioItem).volume = cmd.volume
      return done(`set volume of ${itemName(n, cmd.id)} to ${Math.round(cmd.volume * 100)}%`, [cmd.id])
    }

    case 'setFormat':
      n.settings = { ...n.settings, aspect: cmd.aspect, ...ASPECT_SIZE[cmd.aspect] }
      return done(`set format to ${cmd.aspect} (${n.settings.width}x${n.settings.height})`, [])
  }
}

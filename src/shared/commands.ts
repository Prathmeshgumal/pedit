import { ASPECT_SIZE, DEFAULT_TEXT_STYLE, IDENTITY_TRANSFORM, MIN_ITEM_MS, STILL_DEFAULT_MS, STILL_MAX_MS, laneOf, type Aspect, type ClipTransform, type AudioItem, type ItemId, type MediaId, type MediaItem,
  type Project, type TextItem, type TextStyle, type VideoItem } from './model'
import type { IdGen } from './ids'
import type { Adjust, FilterRef } from './look'
import { fmtTime } from './time'

export type Command =
  | { type: 'addMedia'; items: MediaItem[] }
  | { type: 'updateMedia'; id: MediaId; patch: Partial<MediaItem> }
  | { type: 'addClip'; mediaId: MediaId; inMs?: number; outMs?: number; after?: ItemId | null; atMs?: number }
  | { type: 'removeItem'; id: ItemId }
  | { type: 'moveItem'; id: ItemId; after?: ItemId | null; toMs?: number; lane?: number }
  | { type: 'trimItem'; id: ItemId; inMs?: number; outMs?: number }
  | { type: 'splitItem'; id: ItemId; atMs: number }
  | { type: 'addText'; text: string; startMs: number; durationMs: number; style?: Partial<TextStyle> }
  | { type: 'updateText'; id: ItemId; text?: string; startMs?: number; durationMs?: number; style?: Partial<TextStyle> }
  | { type: 'setMusic'; mediaId: MediaId; inMs?: number; volume?: number }
  | { type: 'setVolume'; id: ItemId; volume: number }
  | { type: 'setFormat'; aspect: Aspect }
  | { type: 'setTransform'; id: ItemId; transform: Partial<ClipTransform> }
  | { type: 'extractAudio'; id: ItemId }
  | { type: 'removeMedia'; id: MediaId; force?: boolean }
  | { type: 'duplicateItem'; id: ItemId }
  | { type: 'trimToPlayhead'; id: ItemId; atMs: number; side: 'left' | 'right' }
  | { type: 'insertFreeze'; id: ItemId; atMs: number; mediaId: MediaId; durationMs: number }
  | { type: 'replaceClip'; id: ItemId; mediaId: MediaId }
  | { type: 'addAudio'; mediaId: MediaId; startMs: number; lane: number; inMs?: number; outMs?: number; volume?: number }
  /** Filter (null removes it) and/or adjustments (merged into the clip's; null clears them) for video clips. */
  | { type: 'setLook'; ids: ItemId[]; filter?: FilterRef | null; adjust?: Adjust | null }
  /** Several edits as one step (one undo); if any fails, none apply. */
  | { type: 'batch'; commands: Command[]; summary?: string }

export type CommandErrorCode = 'not_found' | 'overlap' | 'invalid' | 'media_not_found' | 'in_use'

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
/** Music/audio items may only overlap on different lanes. */
function assertAudioLanes(a: AudioItem[]): void {
  for (const lane of new Set(a.map(laneOf))) assertNoOverlap(audioSpans(a.filter((x) => laneOf(x) === lane)), lane === 0 ? 'music' : `audio lane ${lane}`)
}
/** Lowest lane with nothing between start and end. */
function freeLane(a: AudioItem[], start: number, end: number, from = 0): number {
  for (let lane = from; ; lane++) if (!a.some((x) => laneOf(x) === lane && x.startMs < end && x.startMs + dur(x) > start)) return lane
}

/** How far into a file an item can reach: a photo has no end of its own. */
const sourceLength = (m: MediaItem): number => (m.kind === 'image' ? STILL_MAX_MS : m.durationMs)

function clampTrim(item: { inMs: number; outMs: number }, media: MediaItem, inMs?: number, outMs?: number): { inMs: number; outMs: number } {
  const len = sourceLength(media)
  const i = int(Math.max(0, Math.min(inMs ?? item.inMs, len)))
  const o = int(Math.max(0, Math.min(outMs ?? item.outMs, len)))
  if (o - i < MIN_ITEM_MS) fail('invalid', `resulting length ${o - i}ms is shorter than ${MIN_ITEM_MS}ms`)
  return { inMs: i, outMs: o }
}

export function transformText(t: ClipTransform | undefined): string {
  if (!t) return ''
  const c = t.crop
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  return [t.rotate ? `rot ${t.rotate}` : '', t.flipH ? 'flipH' : '', t.flipV ? 'flipV' : '',
    c.x || c.y || c.w < 1 || c.h < 1 ? `crop ${pct(c.x)},${pct(c.y)},${pct(c.w)},${pct(c.h)}` : ''].filter(Boolean).join(' ')
}

/** Pure: returns a new project, never mutates `p`, never changes `revision`. */
export function applyCommand(p: Project, cmd: Command, gen: IdGen): CommandResult {
  if (cmd.type === 'batch') {
    let cur = p
    const summaries: string[] = [], affected: ItemId[] = []
    for (const c of cmd.commands) {
      const r = applyCommand(cur, c, gen)
      cur = r.project; summaries.push(r.summary); affected.push(...r.affected)
    }
    return { project: cur, summary: cmd.summary ?? summaries.join('; '), affected }
  }
  const n = structuredClone(p)
  const taken = new Set<string>([...n.media, ...n.video, ...n.text, ...n.audio].map((x) => x.id))
  const ids: IdGen = (prefix) => {
    let id = gen(prefix)
    while (taken.has(id)) id = gen(prefix)
    taken.add(id)
    return id
  }
  const done = (summary: string, affected: ItemId[]): CommandResult => ({ project: n, summary, affected })

  switch (cmd.type) {
    case 'setLook': {
      for (const id of cmd.ids) {
        const v = n.video.find((x) => x.id === id)
        if (!v) fail('not_found', `video clip ${id} not found (looks only apply to video clips)`)
        const look = { ...v!.look }
        if (cmd.filter !== undefined) look.filter = cmd.filter ? structuredClone(cmd.filter) : null
        if (cmd.adjust !== undefined) look.adjust = cmd.adjust ? { ...look.adjust, ...cmd.adjust } : undefined
        if (!look.filter) delete look.filter
        if (!look.adjust || !Object.keys(look.adjust).length) delete look.adjust
        if (Object.keys(look).length) v!.look = look; else delete v!.look
      }
      const what = cmd.filter ? `filter ${cmd.filter.name}` : cmd.filter === null ? 'removed filter' : 'adjusted colour'
      return done(`${what} on ${cmd.ids.length} clip${cmd.ids.length === 1 ? '' : 's'}`, cmd.ids)
    }

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
      const span = clampTrim({ inMs: 0, outMs: m.kind === 'image' ? STILL_DEFAULT_MS : m.durationMs }, m, cmd.inMs, cmd.outMs)
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
      else { n.audio[index].startMs = to; if (cmd.lane !== undefined) n.audio[index].lane = Math.max(0, int(cmd.lane)); assertAudioLanes(n.audio) }
      return done(`moved ${itemName(n, cmd.id)} to ${fmtTime(to)}`, [cmd.id])
    }

    case 'trimItem': {
      const { track, index } = locate(n, cmd.id)
      if (track === 'text') fail('invalid', 'use updateText to change text timing')
      const item = n[track][index] as VideoItem | AudioItem
      const was = dur(item)
      const oldIn = item.inMs
      Object.assign(item, clampTrim(item, findMedia(n, item.mediaId), cmd.inMs, cmd.outMs))
      if (track === 'audio') {
        // left-edge trim on music: the rest of the song stays where it was against the picture
        let start = item.startMs + (item.inMs - oldIn)
        if (start < 0) { item.inMs -= start; start = 0 }
        item.startMs = start
        if (dur(item) < MIN_ITEM_MS) fail('invalid', `resulting length ${dur(item)}ms is shorter than ${MIN_ITEM_MS}ms`)
      }
      if (track === 'video') ripple(n.video)
      else assertAudioLanes(n.audio)
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
      a.lane = 0
      n.audio = [...n.audio.filter((x) => laneOf(x) !== 0), a]
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

    case 'setTransform': {
      const { track, index } = locate(n, cmd.id)
      if (track !== 'video') fail('invalid', 'only video clips and photos can be rotated, flipped or cropped')
      const v = n.video[index]
      const t: ClipTransform = { ...structuredClone(v.transform ?? IDENTITY_TRANSFORM), ...structuredClone(cmd.transform) }
      if (![0, 90, 180, 270].includes(t.rotate)) fail('invalid', 'rotate must be 0, 90, 180 or 270')
      const c = t.crop
      const ok = (x: number): boolean => Number.isFinite(x) && x >= 0 && x <= 1
      if (![c.x, c.y, c.w, c.h].every(ok) || c.w < 0.05 || c.h < 0.05 || c.x + c.w > 1.0001 || c.y + c.h > 1.0001) fail('invalid', 'crop must stay inside the frame and keep at least 5% of it')
      v.transform = t
      return done(`set framing of ${itemName(n, cmd.id)}: ${transformText(t) || 'original'}`, [cmd.id])
    }

    case 'extractAudio': {
      const { track, index } = locate(n, cmd.id)
      if (track !== 'video') fail('invalid', 'only video clips have sound to extract')
      const v = n.video[index]
      const m = findMedia(n, v.mediaId)
      if (!m.hasAudio || m.kind !== 'video') fail('invalid', `${m.name} has no sound`)
      const a: AudioItem = { id: ids('a'), mediaId: m.id, startMs: v.startMs, inMs: v.inMs, outMs: v.outMs, volume: v.volume || 1, lane: freeLane(n.audio, v.startMs, v.startMs + dur(v)) }
      n.audio.push(a)
      v.volume = 0
      return done(`extracted audio of ${itemName(n, cmd.id)} to ${a.id} (lane ${a.lane})`, [cmd.id, a.id])
    }

    case 'removeMedia': {
      const m = findMedia(n, cmd.id)
      const uses = n.video.filter((v) => v.mediaId === m.id).length + n.audio.filter((a) => a.mediaId === m.id).length
      if (uses && !cmd.force) fail('in_use', `${m.name} is used ${uses} time${uses > 1 ? 's' : ''} on the timeline`)
      n.video = n.video.filter((v) => v.mediaId !== m.id)
      n.audio = n.audio.filter((a) => a.mediaId !== m.id)
      n.media = n.media.filter((x) => x.id !== m.id)
      ripple(n.video)
      return done(`removed ${m.name} from the library${uses ? ` and its ${uses} timeline item${uses > 1 ? 's' : ''}` : ''}`, [m.id])
    }

    case 'duplicateItem': {
      const { track, index } = locate(n, cmd.id)
      if (track === 'video') {
        const copy = { ...structuredClone(n.video[index]), id: ids('c') }
        n.video.splice(index + 1, 0, copy)
        ripple(n.video)
        return done(`duplicated ${itemName(n, cmd.id)} as ${copy.id}`, [copy.id])
      }
      if (track === 'text') {
        const t = n.text[index]
        const copy: TextItem = { ...structuredClone(t), id: ids('t'), startMs: t.startMs + t.durationMs }
        n.text.push(copy)
        n.text.sort((a, b) => a.startMs - b.startMs)
        assertNoOverlap(textSpans(n.text), 'text')
        return done(`duplicated ${itemName(n, cmd.id)} as ${copy.id}`, [copy.id])
      }
      const a = n.audio[index]
      const start = a.startMs + dur(a)
      const copy: AudioItem = { ...structuredClone(a), id: ids('a'), startMs: start, lane: freeLane(n.audio, start, start + dur(a), laneOf(a)) }
      n.audio.push(copy)
      return done(`duplicated ${itemName(n, cmd.id)} as ${copy.id}`, [copy.id])
    }

    case 'trimToPlayhead': {
      const { track, index } = locate(n, cmd.id)
      const at = int(cmd.atMs)
      if (track === 'text') {
        const t = n.text[index]
        const cut = at - t.startMs
        if (cut < MIN_ITEM_MS || t.durationMs - cut < MIN_ITEM_MS) fail('invalid', `playhead ${fmtTime(at)} is not inside ${cmd.id}`)
        if (cmd.side === 'left') { t.startMs = at; t.durationMs -= cut } else t.durationMs = cut
        return done(`deleted the ${cmd.side} part of ${itemName(n, cmd.id)}`, [cmd.id])
      }
      const item = n[track][index] as VideoItem | AudioItem
      const cut = at - item.startMs
      if (cut < MIN_ITEM_MS || dur(item) - cut < MIN_ITEM_MS) fail('invalid', `playhead ${fmtTime(at)} is not inside ${cmd.id}`)
      if (cmd.side === 'left') { item.inMs += cut; if (track === 'audio') item.startMs = at } else item.outMs = item.inMs + cut
      if (track === 'video') ripple(n.video)
      return done(`deleted the ${cmd.side} part of ${itemName(n, cmd.id)}`, [cmd.id])
    }

    case 'insertFreeze': {
      const { track, index } = locate(n, cmd.id)
      if (track !== 'video') fail('invalid', 'freeze frames come from video clips')
      const still = findMedia(n, cmd.mediaId)
      if (still.kind !== 'image') fail('invalid', `${still.name} is not a still image`)
      if (cmd.durationMs < MIN_ITEM_MS) fail('invalid', 'freeze frame too short')
      const v = n.video[index]
      const cut = int(cmd.atMs) - v.startMs
      let at = index + 1
      if (cut >= MIN_ITEM_MS && dur(v) - cut >= MIN_ITEM_MS) {
        const second: VideoItem = { ...structuredClone(v), id: ids('c'), inMs: v.inMs + cut }
        v.outMs = v.inMs + cut
        n.video.splice(index + 1, 0, second)
      } else if (cut < MIN_ITEM_MS) at = index
      const f: VideoItem = { id: ids('c'), mediaId: still.id, startMs: 0, inMs: 0, outMs: int(cmd.durationMs), volume: 1 }
      if (v.transform) f.transform = structuredClone(v.transform)
      n.video.splice(at, 0, f)
      ripple(n.video)
      return done(`added a ${fmtTime(dur(f))} freeze frame ${f.id} at ${fmtTime(f.startMs)}`, [f.id])
    }

    case 'addAudio': {
      const m = findMedia(n, cmd.mediaId)
      if (!m.hasAudio) fail('invalid', `${m.name} has no sound`)
      const span = clampTrim({ inMs: 0, outMs: m.durationMs }, m, cmd.inMs, cmd.outMs)
      const volume = cmd.volume ?? 1
      if (volume < 0 || volume > 2) fail('invalid', 'volume must be between 0 and 2')
      const a: AudioItem = { id: ids('a'), mediaId: m.id, startMs: int(Math.max(0, cmd.startMs)), ...span, volume, lane: Math.max(0, int(cmd.lane)) }
      n.audio.push(a)
      assertAudioLanes(n.audio)
      return done(`added ${a.id} (${m.name}) at ${fmtTime(a.startMs)} on audio lane ${a.lane}`, [a.id])
    }

    case 'replaceClip': {
      const { track, index } = locate(n, cmd.id)
      if (track === 'text') fail('invalid', 'text cannot be replaced with media')
      const m = findMedia(n, cmd.mediaId)
      const item = n[track][index] as VideoItem | AudioItem
      if (track === 'video' && m.kind === 'audio') fail('invalid', `${m.name} has no picture`)
      if (track === 'audio' && !m.hasAudio) fail('invalid', `${m.name} has no sound`)
      const len = Math.min(dur(item), sourceLength(m))
      Object.assign(item, { mediaId: m.id, inMs: 0, outMs: len })
      if (track === 'video') ripple(n.video)
      else assertAudioLanes(n.audio)
      return done(`replaced ${cmd.id} with ${m.name}`, [cmd.id])
    }
  }
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Command } from '../../shared/commands'
import { CommandError } from '../../shared/commands'
import { RevisionMismatch, type EditSession } from '../../shared/session'
import { mediaSummary, timelineSummary } from '../../shared/summary'
import { timelineDurationMs } from '../../shared/model'
import { fmtTime } from '../../shared/time'

/** Work the MCP tools hand back to the main process (it owns ffmpeg and the project folder). */
export interface McpServices {
  /** A contact sheet (video) or the photo itself, as base64 jpeg; times are the frames' source times (null for a photo). */
  lookAtMedia(mediaId: string, count: number): Promise<{ jpegBase64: string; times: number[] | null }>
  /** Extract the frame and insert it as a freeze into Claude's draft; returns the edit summary. */
  freezeFrame(itemId: string, atMs: number, durationMs: number, expectedRevision: number): Promise<string>
  /** The project's story.md ('' if none). */
  getStory(): Promise<string>
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type Result = { content: Content[]; isError?: boolean }
const ok = (text: string): Result => ({ content: [{ type: 'text', text }] })
const err = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true })

const ms = (what: string) => z.number().int().min(0).describe(`${what}, integer milliseconds`)
const rev = z.number().int().describe('The timeline revision you last read (from get_timeline). Edits are refused if the timeline changed since.')
const id = z.string().describe('Item id from get_timeline, e.g. c_000001')
const style = z.object({
  bold: z.boolean().optional(),
  sizePct: z.number().min(1).max(30).optional().describe('Font size as % of frame height (default 8)'),
  color: z.string().optional().describe('CSS hex color, e.g. #ffffff'),
  position: z.enum(['top', 'center', 'bottom', 'custom']).optional().describe('custom = place the text centre at x,y'),
  x: z.number().min(0).max(1).optional().describe('custom position: text centre, 0 = left edge, 1 = right edge'),
  y: z.number().min(0).max(1).optional().describe('custom position: text centre, 0 = top, 1 = bottom'),
  rotation: z.number().min(-180).max(180).optional().describe('Degrees, clockwise'),
  background: z.string().nullable().optional().describe('Box color behind the text (hex with alpha, e.g. #000000aa) or null for none')
}).optional()

/** Register pedit's editor tools on an MCP server. Edit tools always write into Claude's draft. */
export function registerTools(server: McpServer, getSession: () => EditSession | null, services?: McpServices): void {
  // the SDK's generic callback typing doesn't survive our generic wrapper; the zod shape still validates at runtime
  const register = server.registerTool.bind(server) as unknown as (name: string, config: { description: string; inputSchema: z.ZodRawShape }, cb: (args: Record<string, unknown>) => Promise<Result>) => void
  const read = (name: string, description: string, fn: (s: EditSession) => string): void => {
    register(name, { description, inputSchema: {} }, async () => {
      const s = getSession()
      return s ? ok(fn(s)) : err('no project open')
    })
  }
  const edit = <S extends z.ZodRawShape>(name: string, description: string, shape: S, toCmd: (a: z.infer<z.ZodObject<S>>) => Command): void => {
    register(name, { description, inputSchema: { ...shape, expectedRevision: rev } }, async (args) => {
      const s = getSession()
      if (!s) return err('no project open')
      const { expectedRevision, ...rest } = args as { expectedRevision: number } & Record<string, unknown>
      try {
        const r = s.applyToDraft(toCmd(rest as z.infer<z.ZodObject<S>>), 'claude', expectedRevision)
        return ok(`${r.summary} · rev ${s.state().viewRevision}`)
      } catch (e) {
        if (e instanceof RevisionMismatch) return err(`${e.message} — call get_timeline and retry`)
        if (e instanceof CommandError) return err(`${e.code}: ${e.message}`)
        throw e
      }
    })
  }

  read('get_timeline', 'Current timeline (your draft if one is open): every item with id, times and source, plus the revision to pass to edits. Call this before editing.',
    (s) => { const st = s.state(); return timelineSummary(st.view, { draft: st.draftActive, revision: st.viewRevision }) })
  read('list_media', 'All imported media with ids, names, folders, capture dates, durations, resolution and whether they have audio.',
    (s) => mediaSummary(s.state().view))
  read('get_project_settings', 'Output format, size, frame rate, timeline duration and revision.',
    (s) => { const st = s.state(); const p = st.view; return JSON.stringify({ ...p.settings, durationMs: timelineDurationMs(p), revision: st.viewRevision, draft: st.draftActive }) })

  edit('add_clip', 'Add a video clip from media. Video track is ripple (no gaps). Place with `after` (item id, or null for the start) or `atMs` (snaps to the nearest clip boundary); default appends at the end. inMs/outMs pick the part of the source. Photos ("photo" in list_media) default to 5000ms; pass inMs 0 and outMs = the length you want.',
    { mediaId: z.string(), inMs: ms('Source in point').optional(), outMs: ms('Source out point').optional(), after: z.string().nullable().optional(), atMs: ms('Timeline position').optional() },
    (a) => ({ type: 'addClip', ...a }))
  edit('remove_item', 'Remove a clip, text or music item. Removing a video clip closes the gap.', { id }, (a) => ({ type: 'removeItem', id: a.id }))
  edit('move_item', 'Move an item. Video: reorder with `after` (id or null for first) or `toMs`. Text/audio: `toMs` sets the start time; audio may also change `lane` (0 = music row, 1+ = extra sound rows).',
    { id, after: z.string().nullable().optional(), toMs: ms('New position').optional(), lane: z.number().int().min(0).max(20).optional() }, (a) => ({ type: 'moveItem', ...a }))
  edit('trim_item', 'Change the source in/out points of a video clip or music item (source time, not timeline time).',
    { id, inMs: ms('New source in point').optional(), outMs: ms('New source out point').optional() }, (a) => ({ type: 'trimItem', ...a }))
  edit('split_item', 'Split an item in two at a timeline time inside it.', { id, atMs: ms('Timeline time to split at') }, (a) => ({ type: 'splitItem', ...a }))
  edit('add_text', 'Add a text overlay (title or caption) on the text track. Text items may not overlap each other.',
    { text: z.string().min(1), startMs: ms('Start'), durationMs: z.number().int().min(100), style }, (a) => ({ type: 'addText', ...a }))
  edit('update_text', 'Change a text item: its words, timing or style.',
    { id, text: z.string().min(1).optional(), startMs: ms('Start').optional(), durationMs: z.number().int().min(100).optional(), style }, (a) => ({ type: 'updateText', ...a }))
  edit('set_music', 'Set the background music (replaces any existing music). It starts at 0 and plays from inMs of the source.',
    { mediaId: z.string(), inMs: ms('Source start').optional(), volume: z.number().min(0).max(2).optional().describe('1 = original level') }, (a) => ({ type: 'setMusic', ...a }))
  edit('set_volume', 'Set the volume of a video clip or the music (0 = mute, 1 = original, max 2).', { id, volume: z.number().min(0).max(2) }, (a) => ({ type: 'setVolume', ...a }))
  edit('set_format', 'Set the output shape: 16:9 (YouTube), 9:16 (Reels/Shorts/TikTok) or 1:1.', { aspect: z.enum(['16:9', '9:16', '1:1']) }, (a) => ({ type: 'setFormat', aspect: a.aspect }))
  edit('set_transform', 'Frame a video clip: rotate (clockwise quarter turns), mirror (flipH/flipV) and crop (x, y, w, h as 0..1 of the upright source; the crop is then scaled to fill the frame). Only the fields you pass change.',
    { id, rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(), flipH: z.boolean().optional(), flipV: z.boolean().optional(),
      crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.02).max(1), h: z.number().min(0.02).max(1) }).optional() },
    ({ id: i, ...t }) => ({ type: 'setTransform', id: i, transform: t }))
  edit('extract_audio', "Move a video clip's sound onto its own audio row (the clip is muted), so it can be trimmed or moved separately.", { id }, (a) => ({ type: 'extractAudio', id: a.id }))
  edit('duplicate_item', 'Copy an item: a video clip is inserted right after itself, text/audio go after the original on a free spot.', { id }, (a) => ({ type: 'duplicateItem', id: a.id }))
  edit('replace_clip', 'Swap the media of a video clip, keeping its place, length and framing.', { id, mediaId: z.string() }, (a) => ({ type: 'replaceClip', ...a }))

  register('get_story', { description: "The user's story for this video (story.md): what it is about, the order, mood and must-have moments. Read it before planning an edit when the project has one.", inputSchema: {} }, async () => {
    if (!getSession()) return err('no project open')
    if (!services) return err('get_story is not available here')
    const t = (await services.getStory()).trim()
    return ok(t || '(no story yet: the user can write one in the Story tab or attach a .md file in chat)')
  })

  register('freeze_frame', {
    description: 'Hold the frame of a video clip at timeline time atMs as a still for durationMs (default 3000): the clip is split there and the still inserted.',
    inputSchema: { id, atMs: ms('Timeline time of the frame'), durationMs: z.number().int().min(100).max(60000).optional(), expectedRevision: rev }
  }, async (a) => {
    if (!getSession()) return err('no project open')
    if (!services) return err('freeze_frame is not available here')
    try {
      return ok(await services.freezeFrame(a.id as string, a.atMs as number, (a.durationMs as number | undefined) ?? 3000, a.expectedRevision as number))
    } catch (e) {
      if (e instanceof RevisionMismatch) return err(`${e.message} — call get_timeline and retry`)
      if (e instanceof CommandError) return err(`${e.code}: ${e.message}`)
      return err((e as Error).message)
    }
  })

  register('look_at_media', {
    description: 'See what is in a media file: videos come back as a grid of evenly spaced frames with their times written on them; photos as the photo. Use it before choosing clips when the user describes what they want to see.',
    inputSchema: { mediaId: z.string(), count: z.number().int().min(4).max(24).optional().describe('Frames in the grid (default 12)') }
  }, async (a) => {
    const s = getSession()
    if (!s) return err('no project open')
    if (!services) return err('look_at_media is not available here')
    const m = s.state().view.media.find((x) => x.id === a.mediaId)
    if (!m) return err(`media_not_found: no media ${String(a.mediaId)}`)
    if (m.kind === 'audio') return err(`${m.name} is audio only: there is nothing to look at`)
    try {
      const r = await services.lookAtMedia(m.id, (a.count as number | undefined) ?? 12)
      const caption = r.times ? `${m.name}: frames at ${r.times.map(fmtTime).join(', ')} (source time, left to right, top to bottom)` : `${m.name} (photo, ${m.width}x${m.height})`
      return { content: [{ type: 'image', data: r.jpegBase64, mimeType: 'image/jpeg' }, { type: 'text', text: caption }] }
    } catch (e) {
      return err(`could not read ${m.name}: ${(e as Error).message}`)
    }
  })
}

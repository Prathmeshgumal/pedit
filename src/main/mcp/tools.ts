import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Command } from '../../shared/commands'
import { CommandError } from '../../shared/commands'
import { RevisionMismatch, type EditSession } from '../../shared/session'
import { mediaSummary, timelineSummary } from '../../shared/summary'
import { timelineDurationMs } from '../../shared/model'

type Result = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const ok = (text: string): Result => ({ content: [{ type: 'text', text }] })
const err = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true })

const ms = (what: string) => z.number().int().min(0).describe(`${what}, integer milliseconds`)
const rev = z.number().int().describe('The timeline revision you last read (from get_timeline). Edits are refused if the timeline changed since.')
const id = z.string().describe('Item id from get_timeline, e.g. c_000001')
const style = z.object({
  bold: z.boolean().optional(),
  sizePct: z.number().min(1).max(30).optional().describe('Font size as % of frame height (default 8)'),
  color: z.string().optional().describe('CSS hex color, e.g. #ffffff'),
  position: z.enum(['top', 'center', 'bottom']).optional(),
  background: z.string().nullable().optional().describe('Box color behind the text (hex with alpha, e.g. #000000aa) or null for none')
}).optional()

/** Register pedit's editor tools on an MCP server. Edit tools always write into Claude's draft. */
export function registerTools(server: McpServer, getSession: () => EditSession | null): void {
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
  edit('move_item', 'Move an item. Video: reorder with `after` (id or null for first) or `toMs`. Text/music: `toMs` sets the start time.',
    { id, after: z.string().nullable().optional(), toMs: ms('New position').optional() }, (a) => ({ type: 'moveItem', ...a }))
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
}

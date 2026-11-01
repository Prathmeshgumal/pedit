import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Command } from '../../shared/commands'
import { CommandError } from '../../shared/commands'
import { RevisionMismatch, type EditSession } from '../../shared/session'
import { mediaSummary, timelineSummary } from '../../shared/summary'
import { timelineDurationMs } from '../../shared/model'
import { fmtTime } from '../../shared/time'
import { TEXT_ANIMS, type TextStyle } from '../../shared/model'
import type { FontInfo } from '../../shared/fonts'
import type { TextPreset } from '../../shared/textPresets'
import type { FilterPreset } from '../../shared/filterPresets'
import type { Adjust } from '../../shared/look'
import { DEFAULT_TRANSITION_MS, TRANSITIONS, TRANSITION_IDS, type TransitionType } from '../../shared/transitions'

/** Work the MCP tools hand back to the main process (it owns ffmpeg and the project folder). */
export interface McpServices {
  /** A contact sheet (video) or the photo itself, as base64 jpeg; times are the frames' source times (null for a photo). */
  lookAtMedia(mediaId: string, count: number): Promise<{ jpegBase64: string; times: number[] | null }>
  /** Extract the frame and insert it as a freeze into Claude's draft; returns the edit summary. */
  freezeFrame(itemId: string, atMs: number, durationMs: number, expectedRevision: number): Promise<string>
  /** The project's story.md ('' if none). */
  getStory(): Promise<string>
  fonts?: { list(): Promise<FontInfo[]>; find(family: string): Promise<FontInfo | null>; addGoogle(family: string): Promise<FontInfo> }
  filters?: { list(): Promise<FilterPreset[]>; find(name: string): Promise<FilterPreset | null>; save(name: string, description: string, adjust: Adjust): Promise<FilterPreset>; importCube(name: string, description: string, path: string, adjust?: Adjust): Promise<FilterPreset> }
  textStyles?: { list(): Promise<TextPreset[]>; find(name: string): Promise<TextPreset | null>; save(name: string, description: string, style: Partial<TextStyle>): Promise<TextPreset> }
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type Result = { content: Content[]; isError?: boolean }
const ok = (text: string): Result => ({ content: [{ type: 'text', text }] })
const err = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true })

const ms = (what: string) => z.number().int().min(0).describe(`${what}, integer milliseconds`)
const rev = z.number().int().describe('The timeline revision you last read (from get_timeline). Edits are refused if the timeline changed since.')
const id = z.string().describe('Item id from get_timeline, e.g. c_000001')
const anim = z.enum(TEXT_ANIMS as [string, ...string[]])
const style = z.object({
  font: z.string().optional().describe('Font family from list_fonts (add more with add_font)'),
  bold: z.boolean().optional(),
  sizePct: z.number().min(1).max(30).optional().describe('Font size as % of frame height (default 8)'),
  color: z.string().optional().describe('CSS hex color, e.g. #ffffff'),
  position: z.enum(['top', 'center', 'bottom', 'custom']).optional().describe('custom = place the text centre at x,y'),
  x: z.number().min(0).max(1).optional().describe('custom position: text centre, 0 = left edge, 1 = right edge'),
  y: z.number().min(0).max(1).optional().describe('custom position: text centre, 0 = top, 1 = bottom'),
  rotation: z.number().min(-180).max(180).optional().describe('Degrees, clockwise'),
  background: z.string().nullable().optional().describe('Box color behind the text (hex with alpha, e.g. #000000aa) or null for none'),
  outline: z.object({ color: z.string(), width: z.number().min(0).max(30).describe('px at 1080p; 2 = thin, 8 = thick') }).nullable().optional().describe('Letter outline, or null for none'),
  shadow: z.string().nullable().optional().describe('Soft drop shadow colour (hex with alpha), or null for none; a bright colour makes a glow'),
  letterSpacing: z.number().min(-0.1).max(1).optional().describe('Extra space between letters in em, e.g. 0.1'),
  uppercase: z.boolean().optional(),
  animIn: anim.optional().describe('How it comes on (every animation also fades)'),
  animOut: anim.optional().describe('How it goes off'),
  animMs: z.number().int().min(50).max(3000).optional().describe('Animation length, default 400')
}).optional()
const adjustShape = z.object({
  exposure: z.number().min(-100).max(100).optional(),
  brightness: z.number().min(-100).max(100).optional(),
  contrast: z.number().min(-100).max(100).optional(),
  highlights: z.number().min(-100).max(100).optional().describe('- recovers bright skies'),
  shadows: z.number().min(-100).max(100).optional().describe('+ opens up dark areas'),
  saturation: z.number().min(-100).max(100).optional().describe('-100 = black & white'),
  vibrance: z.number().min(-100).max(100).optional().describe('gentler saturation that spares skin tones'),
  temperature: z.number().min(-100).max(100).optional().describe('+ warmer, - cooler'),
  tint: z.number().min(-100).max(100).optional().describe('+ magenta, - green'),
  fade: z.number().min(0).max(100).optional().describe('lifted, matte blacks'),
  shadowHue: z.number().min(0).max(360).optional().describe('split toning: hue (degrees) pushed into shadows, e.g. 190 teal'),
  shadowTone: z.number().min(0).max(100).optional(),
  highlightHue: z.number().min(0).max(360).optional().describe('split toning: hue pushed into highlights, e.g. 35 orange'),
  highlightTone: z.number().min(0).max(100).optional(),
  vignette: z.number().min(0).max(100).optional().describe('darker edges')
}).describe('Colour adjustments; 0 = unchanged')
const preset = z.string().optional().describe('Name of a text style from list_text_styles; `style` fields override it')

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

  /** A preset merged with explicit style fields, font name checked against the library. Throws a message for Claude. */
  const resolveStyle = async (presetName: unknown, st: unknown): Promise<Partial<TextStyle> | undefined> => {
    let out: Partial<TextStyle> | undefined
    if (typeof presetName === 'string' && presetName) {
      const p = services?.textStyles ? await services.textStyles.find(presetName) : null
      if (!p) throw new Error(`no text style "${presetName}": call list_text_styles`)
      out = { ...p.style }
    }
    if (st) out = { ...out, ...(st as Partial<TextStyle>) }
    if (out?.font && services?.fonts) {
      const f = await services.fonts.find(out.font)
      if (!f) throw new Error(`font "${out.font}" is not installed: pick one from list_fonts, or add_font to download it from Google Fonts`)
      out.font = f.family
    }
    return out
  }
  /** Like edit(), but the args are turned into a command asynchronously (library lookups). */
  const editAsync = (name: string, description: string, shape: z.ZodRawShape, toCmd: (a: Record<string, unknown>, s: EditSession) => Promise<Command>): void => {
    register(name, { description, inputSchema: { ...shape, expectedRevision: rev } }, async (args) => {
      const s = getSession()
      if (!s) return err('no project open')
      const { expectedRevision, ...rest } = args as { expectedRevision: number } & Record<string, unknown>
      let cmd: Command
      try { cmd = await toCmd(rest, s) } catch (e) { return err((e as Error).message) }
      try {
        const r = s.applyToDraft(cmd, 'claude', expectedRevision)
        return ok(`${r.summary} · rev ${s.state().viewRevision}`)
      } catch (e) {
        if (e instanceof RevisionMismatch) return err(`${e.message} — call get_timeline and retry`)
        if (e instanceof CommandError) return err(`${e.code}: ${e.message}`)
        throw e
      }
    })
  }

  editAsync('add_text', 'Add a text overlay (title or caption) on the text track. Text items may not overlap each other. Give a `preset` (list_text_styles) for a ready-made look.',
    { text: z.string().min(1), startMs: ms('Start'), durationMs: z.number().int().min(100), preset, style },
    async (a) => ({ type: 'addText', text: a.text as string, startMs: a.startMs as number, durationMs: a.durationMs as number, style: await resolveStyle(a.preset, a.style) }))
  editAsync('update_text', 'Change a text item: its words, timing or style (a `preset` and/or individual style fields).',
    { id, text: z.string().min(1).optional(), startMs: ms('Start').optional(), durationMs: z.number().int().min(100).optional(), preset, style },
    async (a) => ({ type: 'updateText', id: a.id as string, text: a.text as string | undefined, startMs: a.startMs as number | undefined, durationMs: a.durationMs as number | undefined, style: await resolveStyle(a.preset, a.style) }))
  editAsync('add_captions', 'Add many captions in one step (e.g. subtitles for speech, or a line per scene), all with the same look. All or nothing: if one overlaps another text, none are added.',
    { captions: z.array(z.object({ text: z.string().min(1), startMs: ms('Start'), durationMs: z.number().int().min(100) })).min(1).max(500), preset, style },
    async (a) => {
      const st = await resolveStyle(a.preset, a.style)
      const caps = a.captions as Array<{ text: string; startMs: number; durationMs: number }>
      return { type: 'batch', summary: `added ${caps.length} captions`, commands: caps.map((c) => ({ type: 'addText' as const, ...c, style: st })) }
    })
  editAsync('restyle_text', 'Give text items one look in a single step: `ids` (default: every text item) get the `preset` and/or style fields. Use it to keep captions consistent.',
    { ids: z.array(z.string()).optional(), preset, style },
    async (a, s) => {
      const st = await resolveStyle(a.preset, a.style)
      if (!st) throw new Error('give a preset or style fields')
      const ids = (a.ids as string[] | undefined) ?? s.state().view.text.map((t) => t.id)
      return { type: 'batch', summary: `restyled ${ids.length} text items`, commands: ids.map((i) => ({ type: 'updateText' as const, id: i, style: st })) }
    })

  const clipIds = (a: Record<string, unknown>, s: EditSession): string[] => (a.ids as string[] | undefined) ?? s.state().view.video.map((v) => v.id)
  editAsync('apply_filter', 'Give video clips a filter (a named colour look from list_filters) at a strength 0-100 (default 100). `ids` default to every clip; filter null removes it. Keep one look across a sequence.',
    { ids: z.array(z.string()).optional(), filter: z.string().nullable(), strength: z.number().min(0).max(100).optional() },
    async (a, s) => {
      if (a.filter === null) return { type: 'setLook', ids: clipIds(a, s), filter: null }
      const f = services?.filters ? await services.filters.find(a.filter as string) : null
      if (!f) throw new Error(`no filter "${String(a.filter)}": call list_filters, or create_filter to make one`)
      return { type: 'setLook', ids: clipIds(a, s), filter: { name: f.name, strength: ((a.strength as number | undefined) ?? 100) / 100, adjust: f.adjust, ...(f.lut ? { lut: f.lut } : {}) } }
    })
  editAsync('adjust_color', "Fine-tune the colour of video clips (on top of their filter): exposure, contrast, white balance, saturation, highlights/shadows, split toning, vignette. Values merge into the clip's adjustments; `reset` clears them first. `ids` default to every clip.",
    { ids: z.array(z.string()).optional(), adjust: adjustShape, reset: z.boolean().optional() },
    async (a, s) => {
      const ids = clipIds(a, s)
      const set = { type: 'setLook' as const, ids, adjust: a.adjust as Adjust }
      return a.reset ? { type: 'batch', summary: `reset and adjusted colour on ${ids.length} clips`, commands: [{ type: 'setLook', ids, adjust: null }, set] } : set
    })
  register('list_filters', { description: 'Filters (colour looks) you can apply: name, what it is for, its adjustments. Saved ones were made by you or the user; LUT ones use a .cube file.', inputSchema: {} }, async () => {
    if (!services?.filters) return err('filters are not available here')
    return ok((await services.filters.list()).map((f) => `${f.name}${f.source === 'user' ? ` [saved${f.lut ? ', LUT' : ''}]` : ''}: ${f.description} ${JSON.stringify(f.adjust)}`).join('\n'))
  })
  register('create_filter', { description: 'Make a new filter from colour adjustments and save it in the app library (for this and future projects; the user sees it in the Filters tab). Then apply it with apply_filter.',
    inputSchema: { name: z.string().min(1).max(60), description: z.string().max(200).optional(), adjust: adjustShape } }, async (a) => {
    if (!services?.filters) return err('filters are not available here')
    try { const f = await services.filters.save(a.name as string, (a.description as string | undefined) ?? '', a.adjust as Adjust); return ok(`saved filter "${f.name}"`) } catch (e) { return err((e as Error).message) }
  })
  register('import_lut', { description: 'Make a filter from a 3D LUT file (.cube, e.g. one the user attached or downloaded); optional adjustments go on top. It is copied into the app library.',
    inputSchema: { name: z.string().min(1).max(60), path: z.string().describe('Absolute path of the .cube file'), description: z.string().max(200).optional(), adjust: adjustShape.optional() } }, async (a) => {
    if (!services?.filters) return err('filters are not available here')
    try { const f = await services.filters.importCube(a.name as string, (a.description as string | undefined) ?? '', a.path as string, a.adjust as Adjust | undefined); return ok(`saved filter "${f.name}" from the LUT`) } catch (e) { return err((e as Error).message) }
  })

  read('list_transitions', 'Transitions you can put on a cut between two video clips (id: name — when it suits). The clips overlap by its length, so the video gets that much shorter.',
    () => TRANSITIONS.map((t) => `${t.id}: ${t.label}${t.hint ? ` — ${t.hint}` : ''}`).join('\n'))
  edit('set_transition', `Put a transition on the cut INTO each clip in \`ids\` (the clip after the cut; not the first clip). \`ids\` default to every cut. type null removes it. durationMs default ${DEFAULT_TRANSITION_MS}; it is limited to half of either clip. Use sparingly: plain cuts are the norm, a transition marks a change of place, time or mood.`,
    { ids: z.array(z.string()).optional(), type: z.enum(TRANSITION_IDS).nullable(), durationMs: z.number().int().min(100).max(5000).optional() },
    (a) => ({ type: 'setTransition', ids: a.ids ?? 'all', transition: a.type ? { type: a.type as TransitionType, durationMs: a.durationMs ?? DEFAULT_TRANSITION_MS } : null }))
  edit('set_audio_cut', 'J/L cut at the cut into clip `id`: the sound changes before or after the picture. ms < 0 = J-cut (this clip\'s sound starts that much early, under the previous picture: leads into a scene), ms > 0 = L-cut (the previous clip\'s sound runs on over this picture), 0 = plain cut. Typical 300-1500. Only matters for clips with sound.',
    { id: z.string(), ms: z.number().int().min(-5000).max(5000) },
    (a) => ({ type: 'setAudioCut', id: a.id, ms: a.ms }))

  register('list_fonts', { description: 'Fonts you can use for text (family and kind). Any Google Font can be added with add_font.', inputSchema: {} }, async () => {
    if (!services?.fonts) return err('fonts are not available here')
    return ok((await services.fonts.list()).map((f) => `${f.family} (${f.category}${f.faces.some((x) => x.weight >= 700) ? ', has bold' : ''})`).join('\n'))
  })
  register('add_font', { description: 'Download a font from Google Fonts (fonts.google.com) by its family name, e.g. "Bungee" or "Tiro Devanagari Hindi", into the app library; then use it as style.font. The user sees it in the editor too.',
    inputSchema: { family: z.string().min(1) } }, async (a) => {
    if (!services?.fonts) return err('fonts are not available here')
    try {
      const f = await services.fonts.addGoogle(a.family as string)
      return ok(`${f.family} is ready (${f.source === 'builtin' ? 'already bundled' : 'downloaded'}; weights ${f.faces.map((x) => x.weight).join(', ')})`)
    } catch (e) { return err((e as Error).message) }
  })
  register('list_text_styles', { description: 'Ready-made text looks (built-in and saved ones): name, what it is for, and its style fields. Use the name as `preset`.', inputSchema: {} }, async () => {
    if (!services?.textStyles) return err('text styles are not available here')
    return ok((await services.textStyles.list()).map((p) => `${p.name}${p.source === 'user' ? ' [saved]' : ''}: ${p.description} ${JSON.stringify(p.style)}`).join('\n'))
  })
  register('save_text_style', { description: 'Save a text look under a name in the app library so it can be reused (as `preset`) in this and other projects. Saving an existing saved name replaces it.',
    inputSchema: { name: z.string().min(1).max(60), description: z.string().max(200).optional(), style: style.unwrap() } }, async (a) => {
    if (!services?.textStyles) return err('text styles are not available here')
    try {
      const st = await resolveStyle(undefined, a.style)
      const p = await services.textStyles.save(a.name as string, (a.description as string | undefined) ?? '', st ?? {})
      return ok(`saved text style "${p.name}"`)
    } catch (e) { return err((e as Error).message) }
  })

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

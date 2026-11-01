import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyProject, type MediaItem } from '@shared/model'
import { EditSession } from '@shared/session'
import { seqIds } from '@shared/ids'
import { startMcpServer, type McpHandle } from '../../src/main/mcp/server'
import { FontLibrary } from '../../src/main/library/fonts'
import { TextStyleLibrary } from '../../src/main/library/textStyles'
import { FilterLibrary } from '../../src/main/library/filters'
import { resolve } from 'node:path'

const libs = () => ({
  fonts: new FontLibrary(resolve('resources/fonts'), mkdtempSync(join(tmpdir(), 'mcp-f-')), (async () => new Response('', { status: 400 })) as typeof fetch),
  textStyles: new TextStyleLibrary(join(mkdtempSync(join(tmpdir(), 'mcp-ts-')), 'ts.json')),
  filters: ((d) => new FilterLibrary(join(d, 'filters.json'), join(d, 'luts')))(mkdtempSync(join(tmpdir(), 'mcp-fl-')))
})
const services = () => ({ lookAtMedia: async () => ({ jpegBase64: '', times: null }), freezeFrame: async () => '', getStory: async () => '', ...libs() })

const media: MediaItem = {
  id: 'm_a', path: '/v/a.mp4', name: 'a.mp4', folder: 'day1', kind: 'video', createdAt: '2026-03-01T09:00:00Z', importIndex: 0,
  durationMs: 5000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'ready'
}

let session: EditSession
let h: McpHandle
const connect = async (token: string): Promise<Client> => {
  const c = new Client({ name: 't', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return c
}
type R = { isError?: boolean; content: Array<{ type: string; text: string }> }
const text = (r: unknown): string => (r as R).content.map((c) => c.text).join('\n')

describe('pedit MCP server', () => {
  beforeEach(async () => {
    const p = emptyProject('t'); p.media = [media]
    session = new EditSession(p, seqIds())
    h = await startMcpServer(() => session)
  })
  afterEach(async () => { await h.close() })

  it('rejects a wrong token with 401', async () => {
    const r = await fetch(h.url, { method: 'POST', headers: { Authorization: 'Bearer nope', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
    expect(r.status).toBe(401)
    await expect(connect('nope')).rejects.toThrow()
    expect(h.token).toMatch(/^[0-9a-f]{64}$/)
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('writes a claude mcp config with the bearer token', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'mcp-')), 'mcp.json')
    await h.writeConfig(f)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ mcpServers: { pedit: { type: 'http', url: h.url, headers: { Authorization: `Bearer ${h.token}` } } } })
  })

  it('makes an existing, readable config private when it rewrites it', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'mcp-')), 'mcp.json')
    writeFileSync(f, '{}', { mode: 0o644 })
    await h.writeConfig(f)
    expect(statSync(f).mode & 0o777).toBe(0o600)
  })

  it('lists exactly the editor tools', async () => {
    const c = await connect(h.token)
    const names = (await c.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['add_captions', 'add_clip', 'add_font', 'add_text', 'adjust_color', 'apply_filter', 'create_filter', 'duplicate_item', 'extract_audio', 'freeze_frame', 'get_project_settings', 'get_story', 'get_timeline',
      'import_lut', 'list_filters', 'list_fonts', 'list_media', 'list_text_styles', 'list_transitions', 'look_at_media', 'move_item', 'remove_item', 'replace_clip', 'restyle_text', 'save_text_style',
      'set_audio_cut', 'set_format', 'set_music', 'set_transform', 'set_transition', 'set_volume', 'split_item', 'trim_item', 'update_text'])
  })

  it('extract_audio and set_transform land in the draft', async () => {
    const c = await connect(h.token)
    await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 0 } })
    const x = await c.callTool({ name: 'extract_audio', arguments: { id: 'c_000001', expectedRevision: 1 } }) as R
    expect(x.isError).toBeFalsy()
    const t = await c.callTool({ name: 'set_transform', arguments: { id: 'c_000001', rotate: 90, flipH: true, expectedRevision: 2 } }) as R
    expect(t.isError).toBeFalsy()
    const v = session.state().view
    expect(v.audio).toHaveLength(1)
    expect(v.video[0]).toMatchObject({ volume: 0, transform: { rotate: 90, flipH: true } })
    expect(session.state().real.audio).toHaveLength(0)
  })

  it('update_text takes a custom position and rotation; move_item takes a lane', async () => {
    const c = await connect(h.token)
    await c.callTool({ name: 'add_text', arguments: { text: 'Hi', startMs: 0, durationMs: 1000, expectedRevision: 0 } })
    const u = await c.callTool({ name: 'update_text', arguments: { id: 't_000001', style: { position: 'custom', x: 0.25, y: 0.75, rotation: -10 }, expectedRevision: 1 } }) as R
    expect(u.isError).toBeFalsy()
    expect(session.state().view.text[0].style).toMatchObject({ position: 'custom', x: 0.25, y: 0.75, rotation: -10 })
  })

  it('text uses fonts and styles from the library, and refuses fonts that are not installed', async () => {
    await h.close()
    h = await startMcpServer(() => session, services())
    const c = await connect(h.token)
    expect(text(await c.callTool({ name: 'list_fonts', arguments: {} }))).toContain('Bebas Neue (display)')
    expect(text(await c.callTool({ name: 'list_text_styles', arguments: {} }))).toContain('Shorts pop')
    const a = await c.callTool({ name: 'add_text', arguments: { text: 'Day 1', startMs: 0, durationMs: 2000, preset: 'headline', style: { color: '#ff0000' }, expectedRevision: 0 } }) as R
    expect(a.isError).toBeFalsy()
    expect(session.state().view.text[0].style).toMatchObject({ font: 'Bebas Neue', uppercase: true, animIn: 'slide-up', color: '#ff0000' })
    const bad = await c.callTool({ name: 'update_text', arguments: { id: 't_000001', style: { font: 'Comic Sans' }, expectedRevision: 1 } }) as R
    expect(bad.isError).toBe(true)
    expect(text(bad)).toContain('add_font')
    const fine = await c.callTool({ name: 'update_text', arguments: { id: 't_000001', style: { font: 'bebas neue', outline: { color: '#000000', width: 6 }, shadow: null, letterSpacing: 0.1, animOut: 'pop' }, expectedRevision: 1 } }) as R
    expect(fine.isError).toBeFalsy()
    expect(session.state().view.text[0].style).toMatchObject({ font: 'Bebas Neue', outline: { width: 6 }, letterSpacing: 0.1, animOut: 'pop' })
    const nope = await c.callTool({ name: 'add_text', arguments: { text: 'x', startMs: 5000, durationMs: 500, preset: 'Nope', expectedRevision: 2 } }) as R
    expect(text(nope)).toContain('list_text_styles')
  })

  it('adds many captions at once and restyles all text in one call', async () => {
    await h.close()
    h = await startMcpServer(() => session, services())
    const c = await connect(h.token)
    const r = await c.callTool({ name: 'add_captions', arguments: { captions: [{ text: 'one', startMs: 0, durationMs: 900 }, { text: 'two', startMs: 1000, durationMs: 900 }, { text: 'three', startMs: 2000, durationMs: 900 }], preset: 'Subtitle', expectedRevision: 0 } }) as R
    expect(r.isError).toBeFalsy()
    expect(text(r)).toContain('3 captions')
    const v = session.state().view.text
    expect(v.map((t) => t.text)).toEqual(['one', 'two', 'three'])
    expect(v.every((t) => t.style.position === 'bottom')).toBe(true)
    const rev = session.state().viewRevision
    const rs = await c.callTool({ name: 'restyle_text', arguments: { preset: 'Shorts pop', style: { color: '#ffee00' }, expectedRevision: rev } }) as R
    expect(rs.isError).toBeFalsy()
    expect(session.state().view.text.every((t) => t.style.font === 'Montserrat' && t.style.color === '#ffee00')).toBe(true)
    const sv = await c.callTool({ name: 'save_text_style', arguments: { name: 'Trip caption', description: 'for my trip', style: { font: 'Caveat', color: '#ffffff' } } }) as R
    expect(sv.isError).toBeFalsy()
    expect(text(await c.callTool({ name: 'list_text_styles', arguments: {} }))).toContain('Trip caption')
    const overlap = await c.callTool({ name: 'add_captions', arguments: { captions: [{ text: 'a', startMs: 100, durationMs: 300 }], expectedRevision: session.state().viewRevision } }) as R
    expect(overlap.isError).toBe(true)
    expect(session.state().view.text).toHaveLength(3)
  })

  it('creates filters, applies them to clips with a strength, adjusts colour, and shows it in the timeline', async () => {
    await h.close()
    h = await startMcpServer(() => session, services())
    const c = await connect(h.token)
    expect(text(await c.callTool({ name: 'list_filters', arguments: {} }))).toContain('Cinematic')
    await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 0 } })
    await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 1 } })
    const mk = await c.callTool({ name: 'create_filter', arguments: { name: 'Tokyo night', description: 'cool neon', adjust: { temperature: -30, tint: 12, vignette: 30 } } }) as R
    expect(mk.isError).toBeFalsy()
    const ap = await c.callTool({ name: 'apply_filter', arguments: { filter: 'tokyo night', strength: 70, expectedRevision: 2 } }) as R
    expect(ap.isError).toBeFalsy()
    const v = session.state().view.video
    expect(v.every((x) => x.look?.filter?.name === 'Tokyo night' && x.look.filter.strength === 0.7)).toBe(true)
    expect(v[0].look!.filter!.adjust).toMatchObject({ temperature: -30 })
    const adj = await c.callTool({ name: 'adjust_color', arguments: { ids: [v[1].id], adjust: { exposure: 20 }, expectedRevision: 3 } }) as R
    expect(adj.isError).toBeFalsy()
    expect(session.state().view.video[1].look!.adjust).toEqual({ exposure: 20 })
    expect(text(await c.callTool({ name: 'get_timeline', arguments: {} }))).toContain('filter Tokyo night 70%')
    const none = await c.callTool({ name: 'apply_filter', arguments: { filter: 'Nope', expectedRevision: 4 } }) as R
    expect(text(none)).toContain('list_filters')
    const off = await c.callTool({ name: 'apply_filter', arguments: { ids: [v[0].id], filter: null, expectedRevision: 4 } }) as R
    expect(off.isError).toBeFalsy()
    expect(session.state().view.video[0].look).toBeUndefined()
    const dir = mkdtempSync(join(tmpdir(), 'mcp-lut-')); const cube = join(dir, 'x.cube')
    writeFileSync(cube, 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n')
    expect((await c.callTool({ name: 'import_lut', arguments: { name: 'My LUT', path: cube } }) as R).isError).toBeFalsy()
    expect(text(await c.callTool({ name: 'list_filters', arguments: {} }))).toContain('My LUT [saved, LUT]')
  })

  it('transitions and J/L cuts: list, set on a cut or all cuts, and they show in get_timeline', async () => {
    const c = await connect(h.token)
    await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 0 } })
    await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 1 } })
    await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 2 } })
    const list = text(await c.callTool({ name: 'list_transitions', arguments: {} }))
    expect(list).toContain('fade: Cross dissolve')
    expect(list).toContain('zoomin')
    const [, b, cc] = session.state().view.video.map((v) => v.id)
    const one = await c.callTool({ name: 'set_transition', arguments: { ids: [b], type: 'fadeblack', durationMs: 600, expectedRevision: 3 } }) as R
    expect(one.isError).toBeFalsy()
    expect(session.state().view.video[1].transition).toEqual({ type: 'fadeblack', durationMs: 600 })
    const all = await c.callTool({ name: 'set_transition', arguments: { type: 'fade', expectedRevision: 4 } }) as R
    expect(all.isError).toBeFalsy()
    expect(session.state().view.video.map((v) => v.transition?.type ?? null)).toEqual([null, 'fade', 'fade'])
    const bad = await c.callTool({ name: 'set_transition', arguments: { ids: [session.state().view.video[0].id], type: 'fade', expectedRevision: 5 } }) as R
    expect(bad.isError).toBe(true)
    const j = await c.callTool({ name: 'set_audio_cut', arguments: { id: cc, ms: -700, expectedRevision: 5 } }) as R
    expect(j.isError).toBeFalsy()
    const tl = text(await c.callTool({ name: 'get_timeline', arguments: {} }))
    expect(tl).toContain('← fade 0.5s')
    expect(tl).toContain('J-cut 0.7s')
    const off = await c.callTool({ name: 'set_transition', arguments: { ids: [b], type: null, expectedRevision: 6 } }) as R
    expect(off.isError).toBeFalsy()
    expect(session.state().view.video[1].transition).toBeUndefined()
  })

  it('look_at_media returns a picture Claude can see, with the frame times', async () => {
    await h.close()
    h = await startMcpServer(() => session, { lookAtMedia: async (mid, count) => ({ jpegBase64: Buffer.from(`jpeg:${mid}:${count}`).toString('base64'), times: [500, 1500] }), freezeFrame: async () => 'froze', getStory: async () => '# Trip', ...libs() })
    const c = await connect(h.token)
    const r = await c.callTool({ name: 'look_at_media', arguments: { mediaId: 'm_a', count: 8 } }) as { content: Array<{ type: string; mimeType?: string; data?: string; text?: string }> }
    const img = r.content.find((x) => x.type === 'image')!
    expect(img.mimeType).toBe('image/jpeg')
    expect(Buffer.from(img.data!, 'base64').toString()).toBe('jpeg:m_a:8')
    expect(r.content.find((x) => x.type === 'text')!.text).toContain('0:00.5')
    const f = await c.callTool({ name: 'freeze_frame', arguments: { id: 'c_1', atMs: 1000, expectedRevision: 0 } }) as R
    expect(text(f)).toContain('froze')
    expect(text(await c.callTool({ name: 'get_story', arguments: {} }))).toBe('# Trip')
  })

  it('reads media, edits into a draft, and guards the revision', async () => {
    const c = await connect(h.token)
    expect(text(await c.callTool({ name: 'list_media', arguments: {} }))).toContain('a.mp4')
    const add = await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 0 } }) as R
    expect(add.isError).toBeFalsy()
    expect(text(add)).toMatch(/ · rev 1$/)
    expect(session.state().draftActive).toBe(true)
    expect(session.state().real.video).toHaveLength(0)
    expect(session.state().view.video).toHaveLength(1)

    const stale = await c.callTool({ name: 'add_clip', arguments: { mediaId: 'm_a', expectedRevision: 0 } }) as R
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('timeline changed (rev 1, you sent 0) — call get_timeline and retry')

    expect(text(await c.callTool({ name: 'get_timeline', arguments: {} }))).toContain('DRAFT')
    const bad = await c.callTool({ name: 'remove_item', arguments: { id: 'c_nope', expectedRevision: 1 } }) as R
    expect(bad.isError).toBe(true)
    expect(text(bad)).toContain('not_found')
  })

  it('says when no project is open', async () => {
    await h.close()
    h = await startMcpServer(() => null)
    const c = await connect(h.token)
    const r = await c.callTool({ name: 'get_timeline', arguments: {} }) as R
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('no project open')
  })
})

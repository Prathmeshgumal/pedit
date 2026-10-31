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
    expect(names).toEqual(['add_clip', 'add_text', 'duplicate_item', 'extract_audio', 'freeze_frame', 'get_project_settings', 'get_timeline', 'list_media', 'look_at_media',
      'move_item', 'remove_item', 'replace_clip', 'set_format', 'set_music', 'set_transform', 'set_volume', 'split_item', 'trim_item', 'update_text'])
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

  it('look_at_media returns a picture Claude can see, with the frame times', async () => {
    await h.close()
    h = await startMcpServer(() => session, { lookAtMedia: async (mid, count) => ({ jpegBase64: Buffer.from(`jpeg:${mid}:${count}`).toString('base64'), times: [500, 1500] }), freezeFrame: async () => 'froze' })
    const c = await connect(h.token)
    const r = await c.callTool({ name: 'look_at_media', arguments: { mediaId: 'm_a', count: 8 } }) as { content: Array<{ type: string; mimeType?: string; data?: string; text?: string }> }
    const img = r.content.find((x) => x.type === 'image')!
    expect(img.mimeType).toBe('image/jpeg')
    expect(Buffer.from(img.data!, 'base64').toString()).toBe('jpeg:m_a:8')
    expect(r.content.find((x) => x.type === 'text')!.text).toContain('0:00.5')
    const f = await c.callTool({ name: 'freeze_frame', arguments: { id: 'c_1', atMs: 1000, expectedRevision: 0 } }) as R
    expect(text(f)).toContain('froze')
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdtempSync, readFileSync } from 'node:fs'
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

  it('lists exactly the editor tools', async () => {
    const c = await connect(h.token)
    const names = (await c.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['add_clip', 'add_text', 'get_project_settings', 'get_timeline', 'list_media', 'move_item', 'remove_item', 'set_format', 'set_music', 'set_volume', 'split_item', 'trim_item', 'update_text'])
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

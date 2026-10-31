import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { emptyProject, type MediaItem } from '@shared/model'
import { EditSession } from '@shared/session'
import { seqIds } from '@shared/ids'
import { startMcpServer, type McpHandle } from '../../src/main/mcp/server'
import { ClaudeRunner, buildTurnPrompt } from '../../src/main/claude/runner'
import type { RunnerEvent } from '../../src/main/claude/stream'

const FAKE = resolve('tests/fake-claude/fake-claude.mjs')
const m = (id: string, name: string): MediaItem => ({ id, path: `/v/${name}`, name, folder: 'day1', kind: 'video', createdAt: '2026-03-01T09:00:00Z', importIndex: 0,
  durationMs: 5000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'ready' })

let h: McpHandle, dir: string, session: EditSession, log: string
const runner = (bin = FAKE): ClaudeRunner => new ClaudeRunner({ bin, mcpConfigPath: join(dir, 'mcp.json'), guidePath: resolve('src/main/claude/editor-guide.md'), cwd: dir })
const collect = async (r: ClaudeRunner, msg: string, sid: string | null = null): Promise<RunnerEvent[]> => { const ev: RunnerEvent[] = []; await r.send(msg, sid, (e) => ev.push(e)); return ev }

describe('ClaudeRunner', () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pedit-run-'))
    const p = emptyProject('t'); p.media = [m('m_a', 'a.mp4')]
    session = new EditSession(p, seqIds())
    h = await startMcpServer(() => session)
    await h.writeConfig(join(dir, 'mcp.json'))
    log = join(dir, 'argv.log')
    process.env.FAKE_CLAUDE_ARGV_LOG = log
    delete process.env.FAKE_CLAUDE_MODE
  })
  afterEach(async () => { await h.close() })

  it('streams tool steps and edits the draft through MCP', async () => {
    const r = runner()
    const ev = await collect(r, 'make a title')
    expect(ev.map((e) => e.kind)).toEqual(['tool', 'toolResult', 'tool', 'toolResult', 'tool', 'toolResult', 'tool', 'toolResult', 'text', 'done'])
    expect(ev.at(-1)).toMatchObject({ kind: 'done', ok: true, sessionId: 'fake-1' })
    expect(session.state().view.video).toHaveLength(1)
    expect(session.state().real.video).toHaveLength(0)
    await collect(r, 'again', 'fake-1')
    const [a1, a2] = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
    for (const f of ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--allowedTools', 'mcp__pedit__*', '--mcp-config', '--append-system-prompt']) expect(a1).toContain(f)
    expect(a1).not.toContain('--resume')
    // Claude Code's own file/shell tools are removed, and the user's permission mode can't widen access
    const dis = a1.slice(a1.indexOf('--disallowedTools') + 1)
    for (const t of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task']) expect(dis).toContain(t)
    expect(a1.slice(a1.indexOf('--permission-mode'), a1.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'default'])
    expect(a2.slice(a2.indexOf('--resume'), a2.indexOf('--resume') + 2)).toEqual(['--resume', 'fake-1'])
    expect(r.running).toBe(false)
  }, 30000)

  it('passes the chosen model and effort, and leaves them out on default', async () => {
    const withChoice = new ClaudeRunner({ bin: FAKE, mcpConfigPath: join(dir, 'mcp.json'), guidePath: resolve('src/main/claude/editor-guide.md'), cwd: dir, model: 'sonnet', effort: 'high' })
    await collect(withChoice, 'hi')
    await collect(runner(), 'hi')
    const [a1, a2] = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
    expect(a1.slice(a1.indexOf('--model'), a1.indexOf('--model') + 2)).toEqual(['--model', 'sonnet'])
    expect(a1.slice(a1.indexOf('--effort'), a1.indexOf('--effort') + 2)).toEqual(['--effort', 'high'])
    expect(a2).not.toContain('--model')
    expect(a2).not.toContain('--effort')
  }, 30000)

  it('reports not_logged_in', async () => {
    process.env.FAKE_CLAUDE_MODE = 'not_logged_in'
    expect((await collect(runner(), 'x')).at(-1)).toMatchObject({ kind: 'done', ok: false, error: 'not_logged_in' })
  })

  it('reports not_logged_in when Claude only prints it on stderr and exits', async () => {
    process.env.FAKE_CLAUDE_MODE = 'not_logged_in_stderr'
    expect((await collect(runner(), 'x')).at(-1)).toMatchObject({ kind: 'done', ok: false, error: 'not_logged_in' })
  })

  it('reports crashed when the process dies without a result', async () => {
    process.env.FAKE_CLAUDE_MODE = 'crash'
    expect((await collect(runner(), 'x')).at(-1)).toMatchObject({ kind: 'done', ok: false, error: 'crashed' })
  }, 20000)

  it('stop() ends a slow run as stopped within 4s', async () => {
    process.env.FAKE_CLAUDE_MODE = 'slow'
    const r = runner()
    const ev: RunnerEvent[] = []
    const p = r.send('x', null, (e) => ev.push(e))
    await new Promise((res) => setTimeout(res, 1500))
    expect(r.running).toBe(true)
    const t0 = Date.now()
    r.stop()
    await p
    expect(Date.now() - t0).toBeLessThan(4000)
    expect(ev.at(-1)).toMatchObject({ kind: 'done', ok: false, error: 'stopped' })
  }, 20000)

  it('check() reports a missing binary as not_installed, and a present one with its version', async () => {
    expect(await runner('/nope/claude').check()).toEqual({ ok: false, reason: 'not_installed' })
    expect(await runner().check()).toEqual({ ok: true, version: '9.9.9 (Fake Claude)' })
    expect((await collect(runner('/nope/claude'), 'x')).at(-1)).toMatchObject({ kind: 'done', ok: false, error: 'not_installed' })
  })
})

describe('buildTurnPrompt', () => {
  it('returns the user text unchanged with empty context', () => {
    expect(buildTurnPrompt('hello', { lastDraft: null, userEdits: [], tags: [] })).toBe('hello')
  })
  it('prefixes an [editor] line with draft outcome, user edits and referenced clips', () => {
    expect(buildTurnPrompt('use it first', { lastDraft: 'rejected', userEdits: ['trimmed c_000002 (a.mp4) to 0:02.0 (was 0:05.0)'], tags: [{ name: 'shrine.mov', mediaId: 'm_000004' }] }))
      .toBe('[editor] Last draft: rejected. User edited the draft: trimmed c_000002 (a.mp4) to 0:02.0 (was 0:05.0). Referenced clips: @shrine.mov = m_000004\nuse it first')
  })
})
void writeFileSync

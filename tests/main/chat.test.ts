import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { emptyProject, type MediaItem } from '@shared/model'
import { EditSession } from '@shared/session'
import { seqIds } from '@shared/ids'
import type { ChatEntry } from '@shared/ipc'
import { startMcpServer, type McpHandle } from '../../src/main/mcp/server'
import { ChatController } from '../../src/main/chat'
import type { Editor } from '../../src/main/editor'

const m: MediaItem = { id: 'm_a', path: '/v/a.mp4', name: 'a.mp4', folder: 'day1', kind: 'video', createdAt: '2026-03-01T09:00:00Z', importIndex: 0,
  durationMs: 5000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'ready' }

let h: McpHandle
afterEach(async () => { await h?.close(); delete process.env.FAKE_CLAUDE_FAIL_RESUME; delete process.env.PEDIT_CLAUDE_BIN })

async function setup(claudeSessionId: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'pedit-chat-'))
  const p = emptyProject('t'); p.media = [m]
  const session = new EditSession(p, seqIds())
  const log: ChatEntry[] = []
  const store = { dir, claudeSessionId, appendChat: async (e: ChatEntry) => { log.push(e) }, readChat: async () => log,
    setClaudeSessionId: async (id: string) => { store.claudeSessionId = id } }
  const editor = { store, session } as unknown as Editor
  h = await startMcpServer(() => session)
  const cfg = join(dir, 'mcp.json'); await h.writeConfig(cfg)
  process.env.PEDIT_CLAUDE_BIN = resolve('tests/fake-claude/fake-claude.mjs')
  const chat = new ChatController(editor, { mcpConfig: () => cfg, guide: resolve('src/main/claude/editor-guide.md') }, () => {})
  return { chat, store, session, log }
}

describe('ChatController', () => {
  it('retries once without --resume when the saved Claude session is gone', async () => {
    process.env.FAKE_CLAUDE_FAIL_RESUME = '1'
    const { chat, store, session, log } = await setup('old-session')
    await chat.send('make a title', [])
    expect(store.claudeSessionId).toBe('fake-1')
    expect(session.state().view.video).toHaveLength(1)
    expect(log.some((e) => e.role === 'system')).toBe(false)
  }, 30000)

  it('refuses a second send while one is starting, and refuses draft decisions while running', async () => {
    const { chat } = await setup(null)
    const first = chat.send('one', [])
    expect(chat.running).toBe(true)
    await expect(chat.send('two', [])).rejects.toThrow(/already working/)
    await first
    expect(chat.running).toBe(false)
  }, 30000)
})

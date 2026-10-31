import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseStreamLine, type RunnerEvent } from '../../src/main/claude/stream'

const sample = (n: string): RunnerEvent[] =>
  readFileSync(join(import.meta.dirname, 'fixtures/stream', n), 'utf8').split('\n').filter(Boolean).flatMap(parseStreamLine)

describe('parseStreamLine', () => {
  it('maps a plain reply: text then done with session id', () => {
    const ev = sample('hello.jsonl')
    expect(ev.map((e) => e.kind)).toEqual(['text', 'done'])
    const done = ev.at(-1) as Extract<RunnerEvent, { kind: 'done' }>
    expect(done.ok).toBe(true)
    expect(done.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(done.usage).toBeTruthy()
  })
  it('maps a tool call and its result, stripping the mcp prefix', () => {
    const ev = sample('tool.jsonl')
    expect(ev.map((e) => e.kind)).toEqual(['tool', 'toolResult', 'text', 'done'])
    const t = ev[0] as Extract<RunnerEvent, { kind: 'tool' }>
    const r = ev[1] as Extract<RunnerEvent, { kind: 'toolResult' }>
    expect(t.name).toBe('Read'); expect(r.id).toBe(t.id); expect(r.ok).toBe(true); expect(r.text).toContain('pedit sample file')
    const mcp = parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'mcp__pedit__add_clip', input: { mediaId: 'm' } }] } }))
    expect(mcp).toEqual([{ kind: 'tool', id: 'x', name: 'add_clip', input: { mediaId: 'm' } }])
    // Claude Code's own tools (e.g. ToolSearch) are marked internal so the chat can hide them
    expect(t).toMatchObject({ name: 'Read', internal: true })
  })
  it('maps tool errors and error results', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{ type: 'text', text: 'not_found: item c_1 not found' }] }] } })))
      .toEqual([{ kind: 'toolResult', id: 'x', ok: false, text: 'not_found: item c_1 not found' }])
    const res = (msg: string): RunnerEvent => parseStreamLine(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: msg, session_id: 's' }))[0]
    expect(res('Invalid API key · Please run /login')).toMatchObject({ kind: 'done', ok: false, error: 'not_logged_in' })
    expect(res('Claude AI usage limit reached')).toMatchObject({ kind: 'done', ok: false, error: 'usage_limit' })
    expect(res('boom')).toMatchObject({ kind: 'done', ok: false, error: 'crashed', message: 'boom' })
  })
  it('ignores unknown and malformed lines', () => {
    expect(parseStreamLine('{"type":"rate_limit_event"}')).toEqual([])
    expect(parseStreamLine('not json')).toEqual([])
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }] } }))).toEqual([])
  })
})

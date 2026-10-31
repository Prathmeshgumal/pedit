export type RunnerError = 'not_installed' | 'not_logged_in' | 'usage_limit' | 'stopped' | 'crashed'
export type RunnerEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; internal?: true }
  | { kind: 'toolResult'; id: string; ok: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; ok: boolean; error?: RunnerError; message?: string; usage?: unknown }

const MCP_PREFIX = 'mcp__pedit__'

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown }

const resultText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: { type?: string; text?: string }) => (x?.type === 'text' ? x.text ?? '' : '')).join('\n') : ''

export function classifyError(message: string): RunnerError {
  const m = message.toLowerCase()
  if (/log ?in|authenticat|api key/.test(m)) return 'not_logged_in'
  if (m.includes('limit')) return 'usage_limit'
  return 'crashed'
}

/** One line of `claude -p --output-format stream-json` → zero or more runner events. Pure. */
export function parseStreamLine(line: string): RunnerEvent[] {
  let d: { type?: string; subtype?: string; message?: { content?: Block[] }; is_error?: boolean; result?: string; session_id?: string; usage?: unknown }
  try { d = JSON.parse(line) } catch { return [] }
  if (!d || typeof d !== 'object') return []
  if (d.type === 'assistant') {
    const out: RunnerEvent[] = []
    for (const b of d.message?.content ?? []) {
      if (b.type === 'text' && b.text) out.push({ kind: 'text', text: b.text })
      else if (b.type === 'tool_use') {
        const name = b.name ?? ''
        out.push(name.startsWith(MCP_PREFIX)
          ? { kind: 'tool', id: b.id ?? '', name: name.slice(MCP_PREFIX.length), input: b.input }
          : { kind: 'tool', id: b.id ?? '', name, input: b.input, internal: true })
      }
    }
    return out
  }
  if (d.type === 'user') {
    return (d.message?.content ?? []).filter((b) => b.type === 'tool_result')
      .map((b) => ({ kind: 'toolResult' as const, id: b.tool_use_id ?? '', ok: !b.is_error, text: resultText(b.content) }))
  }
  if (d.type === 'result') {
    const sessionId = d.session_id ?? null
    if (!d.is_error) return [{ kind: 'done', sessionId, ok: true, usage: d.usage }]
    const message = d.result ?? d.subtype ?? 'Claude stopped with an error'
    return [{ kind: 'done', sessionId, ok: false, error: classifyError(message), message, usage: d.usage }]
  }
  return []
}

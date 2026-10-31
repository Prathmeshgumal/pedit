#!/usr/bin/env node
// Stand-in for `claude -p ... --output-format stream-json` used by tests.
// Talks to pedit's real MCP server from --mcp-config and prints valid stream-json.
import { readFileSync, appendFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const argv = process.argv.slice(2)
if (argv.includes('--version')) { console.log('9.9.9 (Fake Claude)'); process.exit(0) }
if (process.env.FAKE_CLAUDE_ARGV_LOG) appendFileSync(process.env.FAKE_CLAUDE_ARGV_LOG, JSON.stringify(argv) + '\n')
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const mode = process.env.FAKE_CLAUDE_MODE ?? 'default'
const sessionId = 'fake-1'
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let prompt = ''
if (!process.stdin.isTTY) for await (const c of process.stdin) prompt += c

if (process.env.FAKE_CLAUDE_FAIL_RESUME && flag('--resume')) {
  process.stderr.write(`No conversation found with session ID: ${flag('--resume')}\n`)
  process.exit(1)
}

if (mode === 'not_logged_in_stderr') {
  process.stderr.write('Invalid API key · Please run /login\n')
  process.exit(1)
}

out({ type: 'system', subtype: 'init', session_id: sessionId, tools: [], mcp_servers: [{ name: 'pedit', status: 'connected' }] })

if (mode === 'not_logged_in') {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: sessionId })
  process.exit(1)
}

const cfg = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8')).mcpServers.pedit
const client = new Client({ name: 'fake-claude', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } }))

let n = 0
async function call(name, args) {
  const id = `toolu_fake_${++n}`
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: `mcp__pedit__${name}`, input: args }] }, session_id: sessionId })
  const r = await client.callTool({ name, arguments: args })
  const text = r.content.map((c) => c.text).join('\n')
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: !!r.isError, content: [{ type: 'text', text }] }] }, session_id: sessionId })
  if (mode === 'slow' && !name.startsWith('get_') && name !== 'list_media') await sleep(10000)
  if (mode === 'crash' && n === 2) process.exit(1)
  return text
}
const revOf = (t) => Number(/rev (\d+)/.exec(t)[1])
const mediaLines = (t) => t.split('\n').map((l) => { const [head, folder, when, dur, kind] = l.split(' · '); const [id, ...name] = head.split(' '); return { id, name: name.join(' '), folder: folder.replace('folder ', ''), when, dur, audioOnly: kind === 'audio only' } })

const tl = await call('get_timeline', {})
const media = mediaLines(await call('list_media', {}))
let rev = revOf(tl)

if (mode === 'look') {
  // look at the first attached file, then say how big the picture was
  const id = /Attached: [^\n]*?\((m_[\w]+), /.exec(prompt)?.[1]
  const r = id ? await client.callTool({ name: 'look_at_media', arguments: { mediaId: id } }) : null
  const img = r?.content.find((c) => c.type === 'image')
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: img ? `I saw ${Buffer.from(img.data, 'base64').length} bytes` : `no picture (${id ?? 'no attachment'})` }] }, session_id: sessionId })
} else if (mode === 'question') {
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `You have ${media.length} clips.` }] }, session_id: sessionId })
} else if (mode === 'demo') {
  // every day1 video clip in capture order, 3s each; title; music; vertical
  for (const m of media.filter((x) => x.folder === 'day1' && !x.audioOnly)) rev = revOf(await call('add_clip', { mediaId: m.id, inMs: 0, outMs: 3000, expectedRevision: rev }))
  rev = revOf(await call('add_text', { text: 'Tokyo', startMs: 0, durationMs: 2000, expectedRevision: rev }))
  const music = media.find((x) => x.audioOnly)
  if (music) rev = revOf(await call('set_music', { mediaId: music.id, expectedRevision: rev }))
  rev = revOf(await call('set_format', { aspect: '9:16', expectedRevision: rev }))
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Made a vertical Tokyo reel with music.' }] }, session_id: sessionId })
} else {
  const first = media.find((x) => !x.audioOnly)
  rev = revOf(await call('add_clip', { mediaId: first.id, expectedRevision: rev }))
  rev = revOf(await call('add_text', { text: 'Tokyo', startMs: 0, durationMs: 2000, expectedRevision: rev }))
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Added ${first.name} and a "Tokyo" title.` }] }, session_id: sessionId })
}
await client.close()
out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sessionId, usage: { input_tokens: 1, output_tokens: 1 }, prompt_chars: prompt.length })

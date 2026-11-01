import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { classifyError, parseStreamLine, type RunnerEvent } from './stream'

export type { RunnerEvent } from './stream'

export interface TurnContext {
  lastDraft: 'accepted' | 'rejected' | 'pending' | null
  userEdits: string[]
  /** @-referenced clips; `attached` marks files the user attached to this message (with their kind). */
  tags: Array<{ name: string; mediaId: string; attached?: 'photo' | 'video' | 'audio' | 'story' | 'file'; path?: string }>
  /** Words in the project's story.md (0 or missing = no story). */
  storyWords?: number
  /** Contents of attached text files (subtitles, notes, CSV…), since Claude can't open files itself. */
  fileTexts?: Array<{ name: string; text: string; truncated: boolean }>
}

/** Text files up to this size go into the prompt whole; longer ones are cut. */
export const ATTACHED_TEXT_LIMIT = 32 * 1024

/** The start of a file as text, or null when it looks binary (a NUL byte or invalid UTF-8 near the start). */
export async function readAttachedText(path: string, limit = ATTACHED_TEXT_LIMIT): Promise<{ text: string; truncated: boolean } | null> {
  const buf = await readFile(path).catch(() => null)
  if (!buf) return null
  const head = buf.subarray(0, limit)
  if (head.includes(0)) return null
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: buf.length > limit }) } catch { return null }
  return { text, truncated: buf.length > limit }
}

/** The user's message, prefixed with one [editor] line of context Claude can't see otherwise, and any attached text. */
export function buildTurnPrompt(userText: string, ctx: TurnContext): string {
  const parts: string[] = []
  if (ctx.lastDraft) parts.push(`Last draft: ${ctx.lastDraft}`)
  if (ctx.userEdits.length) parts.push(`User edited the draft: ${ctx.userEdits.join('; ')}`)
  if (ctx.storyWords) parts.push(`The project has a story (${ctx.storyWords} words): call get_story before planning`)
  const story = ctx.tags.find((t) => t.attached === 'story')
  if (story) parts.push(`The user just attached ${story.name} as the story`)
  const refs = ctx.tags.filter((t) => !t.attached)
  const media = ctx.tags.filter((t) => t.attached && t.attached !== 'story' && t.attached !== 'file')
  const files = ctx.tags.filter((t) => t.attached === 'file')
  if (refs.length) parts.push(`Referenced clips: ${refs.map((t) => `@${t.name} = ${t.mediaId}`).join(', ')}`)
  if (media.length) parts.push(`Attached: ${media.map((t) => `${t.name} (${t.mediaId}, ${t.attached})`).join(', ')}`)
  if (files.length) parts.push(`Attached files: ${files.map((t) => `${t.name} (${t.path})`).join(', ')}`)
  const texts = (ctx.fileTexts ?? []).map((f) => `[file ${f.name}${f.truncated ? `, first ${Math.round(ATTACHED_TEXT_LIMIT / 1024)} KB` : ''}]\n${f.text}\n[end of ${f.name}]`)
  const head = [...(parts.length ? [`[editor] ${parts.join('. ')}`] : []), ...texts]
  return head.length ? `${head.join('\n')}\n${userText}` : userText
}

/** Runs the user's own `claude` CLI headless, one turn at a time, and streams its steps. */
export class ClaudeRunner {
  private child: ChildProcess | null = null
  private stopped = false
  private readonly bin: string

  constructor(private deps: { bin?: string; mcpConfigPath: string; guidePath: string; cwd: string; model?: string; effort?: string }) {
    this.bin = deps.bin ?? process.env.PEDIT_CLAUDE_BIN ?? 'claude'
  }

  get running(): boolean { return this.child !== null }

  check(): Promise<{ ok: true; version: string } | { ok: false; reason: 'not_installed' }> {
    return new Promise((resolve) => {
      execFile(this.bin, ['--version'], { timeout: 15000 }, (err, stdout) => {
        resolve(err ? { ok: false, reason: 'not_installed' } : { ok: true, version: stdout.trim() })
      })
    })
  }

  async send(message: string, sessionId: string | null, onEvent: (e: RunnerEvent) => void): Promise<void> {
    if (this.child) throw new Error('Claude is already working on a request')
    const guide = await readFile(this.deps.guidePath, 'utf8').catch(() => '')
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--mcp-config', this.deps.mcpConfigPath, '--strict-mcp-config',
      '--allowedTools', 'mcp__pedit__*',
      // Claude only edits through pedit's tools: no shell, no file access, no web, whatever the user's own settings allow
      '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task',
      '--permission-mode', 'default',
      ...(guide ? ['--append-system-prompt', guide] : []),
      ...(this.deps.model && this.deps.model !== 'default' ? ['--model', this.deps.model] : []),
      ...(this.deps.effort && this.deps.effort !== 'default' ? ['--effort', this.deps.effort] : []),
      ...(sessionId ? ['--resume', sessionId] : [])]
    this.stopped = false
    let finished = false
    const emit = (e: RunnerEvent): void => {
      if (finished) return
      if (e.kind === 'done') finished = true
      onEvent(e)
    }

    await new Promise<void>((resolve) => {
      const child = spawn(this.bin, args, { cwd: this.deps.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
      this.child = child
      let buf = '', stderr = '', lastSession: string | null = sessionId
      child.stdout!.setEncoding('utf8')
      child.stdout!.on('data', (chunk: string) => {
        buf += chunk
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1)
          const sid = /"session_id"\s*:\s*"([^"]+)"/.exec(line)?.[1]
          if (sid) lastSession = sid
          for (const e of parseStreamLine(line)) {
            // a finished turn after stop() still counts as stopped
            if (e.kind === 'done' && this.stopped) continue
            emit(e)
          }
        }
      })
      child.stderr!.setEncoding('utf8')
      child.stderr!.on('data', (c: string) => { stderr = (stderr + c).slice(-4000) })
      child.on('error', (err: NodeJS.ErrnoException) => {
        emit({ kind: 'done', sessionId: lastSession, ok: false, error: err.code === 'ENOENT' ? 'not_installed' : 'crashed', message: err.message })
      })
      child.on('close', (code, signal) => {
        this.child = null
        if (this.stopped) emit({ kind: 'done', sessionId: lastSession, ok: false, error: 'stopped', message: 'Stopped' })
        else if (!finished) {
          const tail = stderr.trim().split('\n').slice(-3).join('\n')
          emit({ kind: 'done', sessionId: lastSession, ok: false, error: tail ? classifyError(tail) : 'crashed', message: tail || `Claude exited (${signal ?? `code ${code}`})` })
        }
        resolve()
      })
      child.stdin!.on('error', () => {})
      child.stdin!.end(message)
    })
  }

  stop(): void {
    const c = this.child
    if (!c) return
    this.stopped = true
    c.kill('SIGTERM')
    const t = setTimeout(() => { if (this.child === c) c.kill('SIGKILL') }, 3000)
    c.once('close', () => clearTimeout(t))
  }
}

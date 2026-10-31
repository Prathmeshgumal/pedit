import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { parseStreamLine, type RunnerEvent } from './stream'

export type { RunnerEvent } from './stream'

export interface TurnContext {
  lastDraft: 'accepted' | 'rejected' | 'pending' | null
  userEdits: string[]
  tags: Array<{ name: string; mediaId: string }>
}

/** The user's message, prefixed with one [editor] line of context Claude can't see otherwise. */
export function buildTurnPrompt(userText: string, ctx: TurnContext): string {
  const parts: string[] = []
  if (ctx.lastDraft) parts.push(`Last draft: ${ctx.lastDraft}`)
  if (ctx.userEdits.length) parts.push(`User edited the draft: ${ctx.userEdits.join('; ')}`)
  if (ctx.tags.length) parts.push(`Referenced clips: ${ctx.tags.map((t) => `@${t.name} = ${t.mediaId}`).join(', ')}`)
  return parts.length ? `[editor] ${parts.join('. ')}\n${userText}` : userText
}

/** Runs the user's own `claude` CLI headless, one turn at a time, and streams its steps. */
export class ClaudeRunner {
  private child: ChildProcess | null = null
  private stopped = false
  private readonly bin: string

  constructor(private deps: { bin?: string; mcpConfigPath: string; guidePath: string; cwd: string }) {
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
          emit({ kind: 'done', sessionId: lastSession, ok: false, error: 'crashed', message: tail || `Claude exited (${signal ?? `code ${code}`})` })
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

import type { ChatEntry, ChatEvent, ClaudeStatus } from '../shared/ipc'
import { errorText, stepText } from '../shared/chat'
import type { Editor } from './editor'
import { ClaudeRunner, buildTurnPrompt, type TurnContext } from './claude/runner'

/** One chat per open project: runs Claude turns against the editor's session and keeps history. */
export class ChatController {
  private runner: ClaudeRunner | null = null
  private starting = false
  private stopRequested = false
  private lastDraft: TurnContext['lastDraft'] = null

  constructor(private editor: Editor, private paths: { mcpConfig: () => string; guide: string }, private emit: (e: ChatEvent) => void) {}

  status(): Promise<ClaudeStatus> { return this.makeRunner('.').check() }
  get running(): boolean { return this.starting || (this.runner?.running ?? false) }

  noteDraftOutcome(outcome: 'accepted' | 'rejected'): void { this.lastDraft = outcome }
  resetProject(): void { this.lastDraft = null }

  async history(): Promise<ChatEntry[]> { return this.editor.store ? this.editor.store.readChat() : [] }

  stop(): void { this.stopRequested = true; this.runner?.stop() }

  /** Stop any turn and wait until its process is gone (before switching projects). */
  async stopAndWait(): Promise<void> {
    this.stop()
    while (this.running) await new Promise((r) => setTimeout(r, 50))
  }

  async send(text: string, tags: TurnContext['tags']): Promise<void> {
    const store = this.editor.store, session = this.editor.session
    if (!store || !session) throw new Error('no project open')
    if (this.running) throw new Error('Claude is already working')
    this.starting = true // claim the turn before any await so a second send can't slip in
    this.stopRequested = false
    const now = (): string => new Date().toISOString()
    const tools = new Map<string, string>()
    const internal = new Set<string>() // Claude Code's own tools (e.g. ToolSearch) aren't shown
    const log: ChatEntry[] = []
    const hadDraft = session.state().draftActive
    try {
      session.startDraft()
      const ctx: TurnContext = { lastDraft: hadDraft ? 'pending' : this.lastDraft, userEdits: session.takeUserEditsSinceLastTurn(), tags }
      this.lastDraft = null
      await store.appendChat({ at: now(), role: 'user', text })
      const prompt = buildTurnPrompt(text, ctx)

      const turn = async (sessionId: string | null): Promise<{ failedEmpty: boolean; done: Extract<ChatEvent, { kind: 'done' }> | null }> => {
        const runner = this.makeRunner(store.dir)
        this.runner = runner
        this.starting = false
        if (this.stopRequested) runner.stop()
        let any = false
        let done: Extract<ChatEvent, { kind: 'done' }> | null = null
        await runner.send(prompt, sessionId, (e) => {
          if (e.kind === 'done') { done = e; return }
          any = true
          if (e.kind === 'tool' && e.internal) { internal.add(e.id); return }
          if (e.kind === 'toolResult' && internal.has(e.id)) return
          this.emit(e)
          if (e.kind === 'tool') tools.set(e.id, e.name)
          else if (e.kind === 'toolResult') log.push({ at: now(), role: 'step', text: stepText(tools.get(e.id) ?? '', e.ok, e.text) })
          else if (e.kind === 'text') log.push({ at: now(), role: 'assistant', text: e.text })
        })
        const d = done as Extract<ChatEvent, { kind: 'done' }> | null
        return { failedEmpty: !!d && !d.ok && d.error === 'crashed' && !any, done: d }
      }

      let r = await turn(store.claudeSessionId)
      // a saved session Claude can no longer resume (project moved, history cleared): start a fresh one, once
      if (r.failedEmpty && store.claudeSessionId && !this.stopRequested) r = await turn(null)
      const d = r.done ?? { kind: 'done' as const, sessionId: null, ok: false, error: 'crashed' as const }
      if (d.ok && d.sessionId) await store.setClaudeSessionId(d.sessionId)
      if (!d.ok) log.push({ at: now(), role: 'system', text: errorText(d.error, d.message) })
      this.emit(d.ok || !d.sessionId ? d : { ...d, sessionId: null })
    } finally {
      this.starting = false
      for (const entry of log) await store.appendChat(entry)
      // a turn that changed nothing (e.g. a question) leaves no empty draft behind
      const st = session.state()
      if (st.draftActive && st.diff && !st.diff.added.length && !st.diff.removed.length && !st.diff.changed.length && !hadDraft
        && JSON.stringify(st.view.settings) === JSON.stringify(st.real.settings)) session.rejectDraft()
      this.runner = null
    }
  }

  private makeRunner(cwd: string): ClaudeRunner {
    return new ClaudeRunner({ mcpConfigPath: this.paths.mcpConfig(), guidePath: this.paths.guide, cwd })
  }
}

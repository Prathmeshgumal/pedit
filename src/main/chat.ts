import type { ChatEntry, ChatEvent, ClaudeStatus } from '../shared/ipc'
import { errorText, stepText } from '../shared/chat'
import type { Editor } from './editor'
import { ClaudeRunner, buildTurnPrompt, type TurnContext } from './claude/runner'

/** One chat per open project: runs Claude turns against the editor's session and keeps history. */
export class ChatController {
  private runner: ClaudeRunner | null = null
  private lastDraft: TurnContext['lastDraft'] = null

  constructor(private editor: Editor, private paths: { mcpConfig: () => string; guide: string }, private emit: (e: ChatEvent) => void) {}

  status(): Promise<ClaudeStatus> { return this.makeRunner('.').check() }
  get running(): boolean { return this.runner?.running ?? false }

  noteDraftOutcome(outcome: 'accepted' | 'rejected'): void { this.lastDraft = outcome }
  resetProject(): void { this.lastDraft = null }

  async history(): Promise<ChatEntry[]> { return this.editor.store ? this.editor.store.readChat() : [] }

  stop(): void { this.runner?.stop() }

  async send(text: string, tags: TurnContext['tags']): Promise<void> {
    const store = this.editor.store, session = this.editor.session
    if (!store || !session) throw new Error('no project open')
    if (this.running) throw new Error('Claude is already working')
    const hadDraft = session.state().draftActive
    session.startDraft()
    const ctx: TurnContext = { lastDraft: hadDraft ? 'pending' : this.lastDraft, userEdits: session.takeUserEditsSinceLastTurn(), tags }
    this.lastDraft = null
    const now = (): string => new Date().toISOString()
    await store.appendChat({ at: now(), role: 'user', text })

    const runner = this.makeRunner(store.dir)
    this.runner = runner
    const tools = new Map<string, string>()
    const internal = new Set<string>() // Claude Code's own tools (e.g. ToolSearch) aren't shown
    const log: ChatEntry[] = []
    try {
      await runner.send(buildTurnPrompt(text, ctx), store.claudeSessionId, (e) => {
        if (e.kind === 'tool' && e.internal) { internal.add(e.id); return }
        if (e.kind === 'toolResult' && internal.has(e.id)) return
        this.emit(e)
        if (e.kind === 'tool') tools.set(e.id, e.name)
        else if (e.kind === 'toolResult') log.push({ at: now(), role: 'step', text: stepText(tools.get(e.id) ?? '', e.ok, e.text) })
        else if (e.kind === 'text') log.push({ at: now(), role: 'assistant', text: e.text })
        else if (e.kind === 'done') {
          if (e.sessionId) void store.setClaudeSessionId(e.sessionId)
          if (!e.ok) log.push({ at: now(), role: 'system', text: errorText(e.error, e.message) })
        }
      })
    } finally {
      for (const entry of log) await store.appendChat(entry)
      // a turn that changed nothing (e.g. a question) leaves no empty draft behind
      const st = session.state()
      if (st.draftActive && st.diff && !st.diff.added.length && !st.diff.removed.length && !st.diff.changed.length && !hadDraft
        && JSON.stringify(st.view.settings) === JSON.stringify(st.real.settings)) session.rejectDraft()
      if (this.runner === runner) this.runner = null
    }
  }

  private makeRunner(cwd: string): ClaudeRunner {
    return new ClaudeRunner({ mcpConfigPath: this.paths.mcpConfig(), guidePath: this.paths.guide, cwd })
  }
}

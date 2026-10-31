import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { ChatEntry, ChatTag, ClaudeStatus, Settings } from '@shared/ipc'
import { READ_TOOLS, CLAUDE_MODELS, CLAUDE_EFFORTS } from '@shared/ipc'
import { errorText, stepText } from '@shared/chat'
import { useUi } from '../store'
import { getPlayer } from '../preview/instance'

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'step'; text: string; id?: string; running?: boolean; dim?: boolean }
  | { kind: 'system'; text: string }

const fromEntry = (e: ChatEntry): Item =>
  e.role === 'step' ? { kind: 'step', text: e.text, dim: e.text.startsWith('·') } : { kind: e.role, text: e.text }

/** Render `code` spans in short messages. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((p, i) => (p.startsWith('`') ? <code key={i} className="rounded bg-black/40 px-1">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}</>
}

function DraftBar() {
  const session = useUi((s) => s.session)
  const running = useUi((s) => s.chatRunning)
  if (!session?.draftActive || !session.diff) return null
  const d = session.diff
  const fmt = session.view.settings.aspect !== session.real.settings.aspect
  const parts = [`${d.added.length} added`, `${d.removed.length} removed`, `${d.changed.length} changed`, ...(fmt ? [`format ${session.view.settings.aspect}`] : [])]
  return (
    <div data-testid="draft-bar" className="mb-2 rounded-md border border-violet-500 bg-violet-950/50 p-2 text-[11px]">
      <div className="mb-1.5 text-violet-100">Draft: {parts.join(', ')}</div>
      <div className="flex gap-1.5">
        <button data-testid="draft-preview" className="btn" onClick={() => { useUi.getState().previewClip(null); const p = getPlayer(); void p?.seek(0).then(() => p.play()) }}>▶ Preview draft</button>
        <button data-testid="draft-accept" disabled={running} title={running ? 'Wait for Claude to finish (or Stop)' : undefined} className="disabled:opacity-40 rounded bg-emerald-700 px-2 py-0.5 text-white hover:bg-emerald-600" onClick={() => void window.pedit.acceptDraft()}>Accept</button>
        <button data-testid="draft-reject" disabled={running} title={running ? 'Wait for Claude to finish (or Stop)' : undefined} className="disabled:opacity-40 rounded bg-red-900 px-2 py-0.5 text-white hover:bg-red-800" onClick={() => void window.pedit.rejectDraft()}>Reject</button>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const projectId = useUi((s) => s.project?.id)
  const media = useUi((s) => s.project?.media ?? [])
  const [items, setItems] = useState<Item[]>([])
  const running = useUi((s) => s.chatRunning)
  const setRunning = useUi((s) => s.setChatRunning)
  const [text, setText] = useState('')
  const [tags, setTags] = useState<ChatTag[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const toolNames = useRef(new Map<string, string>())

  useEffect(() => { void window.pedit.claudeStatus().then(setStatus) }, [])
  useEffect(() => {
    if (!projectId) return
    void window.pedit.chatHistory().then((h) => setItems(h.map(fromEntry)))
  }, [projectId])

  useEffect(() => window.pedit.onChatEvent((e) => {
    if (e.kind === 'tool') {
      toolNames.current.set(e.id, e.name)
      setItems((x) => [...x, { kind: 'step', id: e.id, running: true, dim: !!READ_TOOLS[e.name], text: READ_TOOLS[e.name] ? `· ${READ_TOOLS[e.name]}` : e.name.replace(/_/g, ' ') }])
    } else if (e.kind === 'toolResult') {
      const name = toolNames.current.get(e.id) ?? ''
      setItems((x) => x.map((it) => (it.kind === 'step' && it.id === e.id ? { ...it, running: false, text: stepText(name, e.ok, e.text) } : it)))
    } else if (e.kind === 'text') setItems((x) => [...x, { kind: 'assistant', text: e.text }])
    else {
      setRunning(false)
      setItems((x) => [...x.map((it) => (it.kind === 'step' && it.running ? { ...it, running: false } : it)), ...(e.ok ? [] : [{ kind: 'system' as const, text: errorText(e.error, e.message) }])])
      setTimeout(() => input.current?.focus(), 0)
    }
  }), [])

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [items])

  const send = async (): Promise<void> => {
    const t = text.trim()
    if (!t || running) return
    // attached files always go with the message; @-tags only if still mentioned
    const used = tags.filter((g) => g.attached || t.includes(`@${g.name}`))
    setItems((x) => [...x, { kind: 'user', text: t }])
    setText(''); setTags([]); setRunning(true)
    try { await window.pedit.sendChat(t, used) } catch (err) {
      setRunning(false)
      setItems((x) => [...x, { kind: 'system', text: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }])
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  const addAttached = (got: ChatTag[]): void => {
    setTags((g) => [...g, ...got.filter((x) => !g.some((y) => y.mediaId === x.mediaId))])
    input.current?.focus()
  }
  const attachPaths = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    try {
      const got = await window.pedit.attachToChat(paths)
      if (got.some((g) => g.attached === 'story')) window.dispatchEvent(new Event('pedit-story'))
      addAttached(got)
    } catch (err) { useUi.getState().showToast((err as Error).message) }
  }
  const attachFiles = (files: FileList | null): void => {
    void attachPaths(Array.from(files ?? []).map((f) => window.pedit.pathForFile(f)).filter(Boolean))
  }
  const onPaste = (e: ClipboardEvent): void => {
    const img = Array.from(e.clipboardData.items).find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
    if (!img) return
    e.preventDefault()
    void img.arrayBuffer().then((b) => window.pedit.attachPastedImage(new Uint8Array(b))).then(addAttached, (err: Error) => useUi.getState().showToast(err.message))
  }

  const onDrop = (e: DragEvent): void => {
    setDropOver(false)
    if (!e.dataTransfer.types.includes('application/x-pedit-media') && e.dataTransfer.files.length) {
      e.preventDefault()
      attachFiles(e.dataTransfer.files)
      return
    }
    const id = e.dataTransfer.getData('application/x-pedit-media')
    const m = media.find((x) => x.id === id)
    if (!m) return
    e.preventDefault()
    setTags((g) => (g.some((x) => x.mediaId === id) ? g : [...g, { name: m.name, mediaId: id }]))
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.name} `)
    input.current?.focus()
  }

  return (
    <div data-testid="chat" className="panel flex min-h-0 flex-col" style={{ gridRow: '2 / 4', gridColumn: '4' }}>
      <div className="panel-title flex items-center">Claude<ClaudePicker /></div>
      {status && !status.ok && (
        <div data-testid="claude-banner" className="mb-2 rounded bg-amber-900/50 p-2 text-[11px] text-amber-100">Claude Code was not found. Install it, run `claude` once to log in, then restart pedit.</div>
      )}
      <div ref={list} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-[12px] leading-snug">
        {items.length === 0 && <div className="p-4 text-center text-xs text-neutral-500">Tell Claude what to make: "a 30s vertical reel of day 1, fast cuts, title Tokyo". Drag clips here to point at them.</div>}
        {items.map((it, i) => {
          if (it.kind === 'user') return <div key={i} data-testid="chat-msg-user" className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-indigo-800 px-2.5 py-1.5 text-white">{it.text}</div>
          if (it.kind === 'assistant') return <div key={i} data-testid="chat-msg-assistant" className="max-w-[95%] whitespace-pre-wrap rounded-lg bg-neutral-800 px-2.5 py-1.5"><Rich text={it.text} /></div>
          if (it.kind === 'system') return <div key={i} data-testid="chat-msg-system" className="rounded bg-amber-900/40 px-2.5 py-1.5 text-amber-100"><Rich text={it.text} /></div>
          return (
            <div key={i} data-testid="chat-step" className={`pl-2 text-[11px] ${it.running ? 'text-amber-300' : it.text.startsWith('✗') ? 'text-red-300' : it.dim ? 'text-neutral-500' : 'text-emerald-300'}`}>
              {it.running ? `⟳ ${it.text}…` : it.text}
            </div>
          )
        })}
        {running && !items.some((x) => x.kind === 'step' && x.running) && <div className="pl-2 text-[11px] text-neutral-500">⟳ thinking…</div>}
      </div>
      <div className="pt-2">
        <DraftBar />
        {tags.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {tags.map((g) => (
              <span key={`${g.mediaId}:${g.name}`} data-testid="chat-chip" title={g.attached ? `Attached ${g.attached}` : 'Clip you pointed at'}
                className="rounded border border-violet-400 bg-violet-500/25 px-1 text-[10px]">{g.attached ? `${g.attached === 'photo' ? '🖼' : g.attached === 'video' ? '🎬' : g.attached === 'story' ? '📄' : '♪'} ` : '@'}{g.name}
                <button className="ml-1 text-neutral-400" onClick={() => setTags((x) => x.filter((y) => y.mediaId !== g.mediaId))}>×</button></span>
            ))}
          </div>
        )}
        <div className={`rounded-lg border bg-neutral-800 p-1.5 ${dropOver ? 'border-violet-300' : 'border-dashed border-violet-400/60'}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-pedit-media') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropOver(true) } }}
          onDragLeave={() => setDropOver(false)} onDrop={onDrop}>
          <textarea ref={input} data-testid="chat-input" rows={3} disabled={running} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
            placeholder={running ? 'Claude is working…' : 'Tell Claude what to do… (drop clips or files here, paste images)'}
            className="w-full resize-none bg-transparent text-xs text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60" />
          <div className="flex items-center justify-end gap-1">
            <input ref={fileInput} data-testid="chat-attach-input" type="file" multiple accept="video/*,audio/*,image/*,.md,.markdown,.txt" className="hidden"
              onChange={(e) => { attachFiles(e.target.files); e.target.value = '' }} />
            <button data-testid="chat-attach" className="btn mr-auto" title="Attach videos, audio or photos" disabled={running} onClick={() => fileInput.current?.click()}>📎</button>
            {running
              ? <button data-testid="chat-stop" className="btn" onClick={() => window.pedit.stopChat()}>■ Stop</button>
              : <button data-testid="chat-send" className="btn-primary" disabled={!text.trim()} onClick={() => void send()}>Send</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

const MODEL_LABEL: Record<Settings['claudeModel'], string> = { default: 'Default model', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }
const EFFORT_LABEL: Record<Settings['claudeEffort'], string> = { default: 'Default effort', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** Which Claude model and how hard it thinks; saved right away, used from the next message. */
function ClaudePicker() {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { void window.pedit.getSettings().then(setS) }, [])
  if (!s) return null
  const save = (patch: Partial<Settings>): void => { setS({ ...s, ...patch }); void window.pedit.setSettings(patch).then(setS) }
  const cls = 'rounded bg-neutral-800 px-1 py-0.5 text-[10px] normal-case tracking-normal text-neutral-300 hover:bg-neutral-700'
  return (
    <span className="ml-auto flex gap-1">
      <select data-testid="claude-model" title="Claude model (applies to your next message)" className={cls} value={s.claudeModel}
        onChange={(e) => save({ claudeModel: e.target.value as Settings['claudeModel'] })}>
        {CLAUDE_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}
      </select>
      <select data-testid="claude-effort" title="How hard Claude thinks (applies to your next message)" className={cls} value={s.claudeEffort}
        onChange={(e) => save({ claudeEffort: e.target.value as Settings['claudeEffort'] })}>
        {CLAUDE_EFFORTS.map((m) => <option key={m} value={m}>{EFFORT_LABEL[m]}</option>)}
      </select>
    </span>
  )
}

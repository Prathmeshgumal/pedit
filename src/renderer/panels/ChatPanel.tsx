import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { ChatEntry, ClaudeStatus } from '@shared/ipc'
import { READ_TOOLS } from '@shared/ipc'
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
  if (!session?.draftActive || !session.diff) return null
  const d = session.diff
  const fmt = session.view.settings.aspect !== session.real.settings.aspect
  const parts = [`${d.added.length} added`, `${d.removed.length} removed`, `${d.changed.length} changed`, ...(fmt ? [`format ${session.view.settings.aspect}`] : [])]
  return (
    <div data-testid="draft-bar" className="mb-2 rounded-md border border-violet-500 bg-violet-950/50 p-2 text-[11px]">
      <div className="mb-1.5 text-violet-100">Draft: {parts.join(', ')}</div>
      <div className="flex gap-1.5">
        <button data-testid="draft-preview" className="btn" onClick={() => { useUi.getState().previewClip(null); const p = getPlayer(); void p?.seek(0).then(() => p.play()) }}>▶ Preview draft</button>
        <button data-testid="draft-accept" className="rounded bg-emerald-700 px-2 py-0.5 text-white hover:bg-emerald-600" onClick={() => void window.pedit.acceptDraft()}>Accept</button>
        <button data-testid="draft-reject" className="rounded bg-red-900 px-2 py-0.5 text-white hover:bg-red-800" onClick={() => void window.pedit.rejectDraft()}>Reject</button>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const projectId = useUi((s) => s.project?.id)
  const media = useUi((s) => s.project?.media ?? [])
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [text, setText] = useState('')
  const [tags, setTags] = useState<Array<{ name: string; mediaId: string }>>([])
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
    const used = tags.filter((g) => t.includes(`@${g.name}`))
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

  const onDrop = (e: DragEvent): void => {
    setDropOver(false)
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
      <div className="panel-title">Claude</div>
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
              <span key={g.mediaId} className="rounded border border-violet-400 bg-violet-500/25 px-1 text-[10px]">@{g.name}
                <button className="ml-1 text-neutral-400" onClick={() => setTags((x) => x.filter((y) => y.mediaId !== g.mediaId))}>×</button></span>
            ))}
          </div>
        )}
        <div className={`rounded-lg border bg-neutral-800 p-1.5 ${dropOver ? 'border-violet-300' : 'border-dashed border-violet-400/60'}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-pedit-media')) { e.preventDefault(); setDropOver(true) } }}
          onDragLeave={() => setDropOver(false)} onDrop={onDrop}>
          <textarea ref={input} data-testid="chat-input" rows={3} disabled={running} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            placeholder={running ? 'Claude is working…' : 'Tell Claude what to do… (drop clips here)'}
            className="w-full resize-none bg-transparent text-xs text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60" />
          <div className="flex justify-end">
            {running
              ? <button data-testid="chat-stop" className="btn" onClick={() => window.pedit.stopChat()}>■ Stop</button>
              : <button data-testid="chat-send" className="btn-primary" disabled={!text.trim()} onClick={() => void send()}>Send</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

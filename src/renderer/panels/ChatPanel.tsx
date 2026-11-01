import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { ChatEntry, ChatTag, ClaudeStatus, Settings } from '@shared/ipc'
import { READ_TOOLS, CLAUDE_MODELS, CLAUDE_EFFORTS } from '@shared/ipc'
import { errorText, stepText } from '@shared/chat'
import { useUi } from '../store'
import { getPlayer } from '../preview/instance'
import { Select } from '../ui/Select'
import { Range } from '../ui/Range'

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
    <div data-testid="draft-bar" className="mb-2 rounded-xl border border-violet-500/60 bg-violet-950/40 px-2.5 py-2 text-[11px]">
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

  // consecutive tool steps show as one activity group under Claude's text
  const blocks: Array<{ kind: 'steps'; steps: Array<Extract<Item, { kind: 'step' }>>; key: number } | { kind: 'item'; it: Item; key: number }> = []
  items.forEach((it, i) => {
    const last = blocks[blocks.length - 1]
    if (it.kind === 'step') { if (last?.kind === 'steps') last.steps.push(it); else blocks.push({ kind: 'steps', steps: [it], key: i }) }
    else blocks.push({ kind: 'item', it, key: i })
  })

  return (
    <div data-testid="chat" className="panel flex min-h-0 flex-col !p-0" style={{ gridRow: '2 / 4', gridColumn: '4' }}>
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <span className="text-[13px] font-semibold text-neutral-100">Claude</span>
        {running && <span className="chat-pulse" aria-label="working" />}
      </div>
      {status && !status.ok && (
        <div data-testid="claude-banner" className="mx-3 mb-2 rounded-md bg-amber-900/40 p-2 text-[11px] text-amber-100">Claude Code was not found. Install it, run `claude` once to log in, then restart pedit.</div>
      )}
      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2 text-[13px] leading-relaxed text-neutral-200">
        {items.length === 0 && (
          <div className="mt-6 space-y-2 text-[12px] text-neutral-500">
            <div className="text-neutral-300">What should we make?</div>
            <div>For example: a 30 second vertical reel of day 1, fast cuts, with the title “Tokyo”.</div>
            <div>Drag clips here to point at them, or attach photos, music and a story file.</div>
          </div>
        )}
        {blocks.map((b) => {
          if (b.kind === 'steps') return <Steps key={b.key} steps={b.steps} />
          const it = b.it
          if (it.kind === 'user') return <div key={b.key} data-testid="chat-msg-user" className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#2c2c33] px-3 py-2 text-neutral-100">{it.text}</div>
          if (it.kind === 'assistant') return <div key={b.key} data-testid="chat-msg-assistant" className="whitespace-pre-wrap"><Rich text={it.text} /></div>
          return <div key={b.key} data-testid="chat-msg-system" className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-[12px] text-amber-100"><Rich text={it.text} /></div>
        })}
        {running && !items.some((x) => x.kind === 'step' && x.running) && <div className="flex items-center gap-2 text-[12px] text-neutral-500"><span className="chat-spin" />Thinking</div>}
      </div>
      <div className="px-2.5 pb-2.5">
        <DraftBar />
        <div className={`rounded-2xl border bg-[#26262c] transition-colors focus-within:border-[#4a4a55] ${dropOver ? 'border-sky-400 bg-sky-950/30' : 'border-[#34343c]'}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-pedit-media') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropOver(true) } }}
          onDragLeave={() => setDropOver(false)} onDrop={onDrop}>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2.5 pt-2.5">
              {tags.map((g) => (
                <span key={`${g.mediaId}:${g.name}`} data-testid="chat-chip" title={g.attached ? `Attached ${g.attached}` : 'Clip you pointed at'}
                  className="flex items-center gap-1 rounded-md bg-[#33333b] py-0.5 pl-1.5 pr-1 text-[11px] text-neutral-200">
                  <span className="text-neutral-400">{g.attached ? (g.attached === 'photo' ? '🖼' : g.attached === 'video' ? '🎬' : g.attached === 'story' ? '📄' : '♪') : '@'}</span>
                  <span className="max-w-[140px] truncate">{g.name}</span>
                  <button className="rounded px-0.5 text-neutral-500 hover:text-neutral-200" aria-label={`Remove ${g.name}`} onClick={() => setTags((x) => x.filter((y) => y.mediaId !== g.mediaId))}>×</button>
                </span>
              ))}
            </div>
          )}
          <textarea ref={input} data-testid="chat-input" rows={3} disabled={running} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
            placeholder={running ? 'Claude is working…' : 'Reply to Claude…'}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60" />
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <input ref={fileInput} data-testid="chat-attach-input" type="file" multiple accept="video/*,audio/*,image/*,.md,.markdown,.txt" className="hidden"
              onChange={(e) => { attachFiles(e.target.files); e.target.value = '' }} />
            <button data-testid="chat-attach" className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-[#33333b] hover:text-neutral-100 disabled:opacity-40"
              title="Attach videos, music, photos or a story file" aria-label="Attach files" disabled={running} onClick={() => fileInput.current?.click()}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
            </button>
            <ClaudePicker />
            {running
              ? <button data-testid="chat-stop" title="Stop" aria-label="Stop" className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-neutral-900 hover:bg-white" onClick={() => window.pedit.stopChat()}>
                  <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg></button>
              : <button data-testid="chat-send" title="Send (Enter)" aria-label="Send" className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2f6db5] text-white hover:bg-[#3a7cc6] disabled:bg-[#33333b] disabled:text-neutral-500" disabled={!text.trim()} onClick={() => void send()}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" /></svg></button>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A run of tool steps: a quiet list with a line down the left; long runs fold to the last few. */
function Steps({ steps }: { steps: Array<Extract<Item, { kind: 'step' }>> }) {
  const [open, setOpen] = useState(false)
  const FOLD = 4
  const hidden = !open && steps.length > FOLD ? steps.length - (FOLD - 1) : 0
  const shown = hidden ? steps.slice(hidden) : steps
  return (
    <div className="border-l border-[#34343c] pl-2.5 text-[11.5px] leading-snug">
      {hidden > 0 && <button className="mb-1 text-neutral-500 hover:text-neutral-300" onClick={() => setOpen(true)}>{hidden} earlier steps</button>}
      {shown.map((it, i) => {
        const failed = it.text.startsWith('✗')
        return (
          <div key={i} data-testid="chat-step" className={`flex items-start gap-1.5 py-0.5 ${it.running ? 'text-neutral-200' : failed ? 'text-red-300' : it.dim ? 'text-neutral-500' : 'text-neutral-400'}`}>
            {it.running ? <span className="chat-spin mt-[3px]" /> : null}
            <span className="min-w-0 break-words">{it.running ? `${it.text}…` : it.text}</span>
          </div>
        )
      })}
      {open && steps.length > FOLD && <button className="mt-1 text-neutral-500 hover:text-neutral-300" onClick={() => setOpen(false)}>Fold</button>}
    </div>
  )
}

const MODEL_LABEL: Record<Settings['claudeModel'], string> = { default: 'Default model', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }
const EFFORT_LABEL: Record<Settings['claudeEffort'], string> = { default: 'Auto', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** Which Claude model and how hard it thinks; saved right away, used from the next message. */
function ClaudePicker() {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { void window.pedit.getSettings().then(setS) }, [])
  if (!s) return <span className="flex-1" />
  const save = (patch: Partial<Settings>): void => { setS({ ...s, ...patch }); void window.pedit.setSettings(patch).then(setS) }
  const ei = CLAUDE_EFFORTS.indexOf(s.claudeEffort)
  return (
    <span className="ml-auto flex min-w-0 items-center gap-2">
      <label className="flex items-center gap-1.5 text-[11px] text-neutral-400" title="How hard Claude thinks (from your next message). Auto lets Claude Code decide.">
        <span data-testid="claude-effort-label" className="w-[52px] text-right">{EFFORT_LABEL[s.claudeEffort]}</span>
        <Range data-testid="claude-effort" data-value={s.claudeEffort} aria-label="Effort" aria-valuetext={EFFORT_LABEL[s.claudeEffort]}
          className="effort w-[64px]" min={0} max={CLAUDE_EFFORTS.length - 1} step={1} value={ei}
          onChange={(e) => save({ claudeEffort: CLAUDE_EFFORTS[Number(e.target.value)] })} />
      </label>
      <Select testid="claude-model" size="sm" title="Claude model (from your next message)" className="max-w-[110px] !bg-transparent hover:!bg-[#33333b]"
        value={s.claudeModel} onChange={(m) => save({ claudeModel: m })}
        options={CLAUDE_MODELS.map((m) => ({ value: m, label: MODEL_LABEL[m] }))} />
    </span>
  )
}

import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { ChatEntry, ChatTag, ClaudeStatus, Settings } from '@shared/ipc'
import { READ_TOOLS, CLAUDE_MODELS } from '@shared/ipc'
import { errorText, stepText } from '@shared/chat'
import { useUi } from '../store'
import { getPlayer } from '../preview/instance'
import { Select } from '../ui/Select'
import { Markdown, InlineText } from '../chat/Markdown'
import { EffortPicker } from '../chat/EffortPicker'

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'step'; text: string; id?: string; running?: boolean; dim?: boolean }
  | { kind: 'system'; text: string }

const fromEntry = (e: ChatEntry): Item =>
  e.role === 'step' ? { kind: 'step', text: e.text, dim: e.text.startsWith('·') } : { kind: e.role, text: e.text }

const MEDIA_DRAG = 'application/x-pedit-media'
const SUGGESTIONS = [
  'Make a 30 second vertical reel of day 1 with fast cuts',
  'Put the music under the whole video and fade it out at the end',
  'Add a title at the start that says “Tokyo”'
]

/** Claude's mark: a small sparkle in Claude's orange. */
function ClaudeMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="flex-none text-[#d97757]">
      <path fill="currentColor" d="M8 0.8c.35 0 .62.26.68.6l.5 3.1a2.4 2.4 0 0 0 1.98 1.98l3.1.5a.69.69 0 0 1 0 1.36l-3.1.5a2.4 2.4 0 0 0-1.98 1.98l-.5 3.1a.69.69 0 0 1-1.36 0l-.5-3.1a2.4 2.4 0 0 0-1.98-1.98l-3.1-.5a.69.69 0 0 1 0-1.36l3.1-.5a2.4 2.4 0 0 0 1.98-1.98l.5-3.1A.69.69 0 0 1 8 .8Z" />
    </svg>
  )
}

/** The icon on an attachment chip. */
function ChipIcon({ tag }: { tag: ChatTag }) {
  const common = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (tag.attached) {
    case undefined: return <span className="text-[11px] leading-none">@</span>
    case 'photo': return <svg {...common}><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1.2" /><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5L13 12" /></svg>
    case 'video': return <svg {...common}><rect x="1.5" y="3.5" width="9" height="9" rx="1.5" /><path d="m10.5 7 4-2.2v6.4l-4-2.2" /></svg>
    case 'audio': return <svg {...common}><path d="M6 12V3.5l7-1.5V10.5" /><circle cx="4.5" cy="12" r="1.6" /><circle cx="11.5" cy="10.5" r="1.6" /></svg>
    case 'story': return <svg {...common}><path d="M4 1.5h5.5L13 5v9.5H4z" /><path d="M9.5 1.5V5H13M6 8h5M6 10.5h5" /></svg>
    case 'file': return <svg {...common}><path d="M4 1.5h5.5L13 5v9.5H4z" /><path d="M9.5 1.5V5H13" /></svg>
  }
}

const CHIP_TITLE: Record<NonNullable<ChatTag['attached']>, string> = {
  photo: 'Attached photo', video: 'Attached video', audio: 'Attached audio', story: 'Attached story (saved as the project story)', file: 'Attached file'
}

function DraftBar() {
  const session = useUi((s) => s.session)
  const running = useUi((s) => s.chatRunning)
  if (!session?.draftActive || !session.diff) return null
  const d = session.diff
  const fmt = session.view.settings.aspect !== session.real.settings.aspect
  // only the counts that aren't zero, so the summary fits the narrow panel
  const parts = [[d.added.length, 'added'], [d.removed.length, 'removed'], [d.changed.length, 'changed']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`)
  if (fmt) parts.push(`format ${session.view.settings.aspect}`)
  const wait = running ? 'Wait for Claude to finish (or Stop)' : undefined
  return (
    <div data-testid="draft-bar" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-violet-500/50 bg-violet-950/40 py-1.5 pl-3 pr-1.5 text-[11.5px]">
      <span className="min-w-[96px] flex-1 text-violet-100" title={`Claude's draft: ${parts.join(', ') || 'no changes yet'}`}>
        <span className="font-medium">Draft</span>{parts.length > 0 && <span className="text-violet-200/80"> · {parts.join(', ')}</span>}
      </span>
      <button data-testid="draft-preview" title="Play the draft from the start" className="rounded-md px-2 py-1 text-violet-100 hover:bg-violet-500/20"
        onClick={() => { useUi.getState().previewClip(null); const p = getPlayer(); void p?.seek(0).then(() => p.play()) }}>▶ Preview</button>
      <button data-testid="draft-reject" disabled={running} title={wait} className="rounded-md px-2 py-1 text-neutral-200 hover:bg-white/10 disabled:opacity-40" onClick={() => void window.pedit.rejectDraft()}>Reject</button>
      <button data-testid="draft-accept" disabled={running} title={wait} className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-500 disabled:opacity-40" onClick={() => void window.pedit.acceptDraft()}>Accept</button>
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
  const dragDepth = useRef(0)
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

  // follow new messages, unless the user scrolled up to read
  const pinned = useRef(true)
  useEffect(() => { if (pinned.current) list.current?.scrollTo({ top: list.current.scrollHeight }) }, [items, running])

  // the input grows with the text, up to about eight lines
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  const send = async (): Promise<void> => {
    const t = text.trim()
    if (!t || running) return
    // attached files always go with the message; @-tags only if still mentioned
    const used = tags.filter((g) => g.attached || t.includes(`@${g.name}`))
    pinned.current = true
    setItems((x) => [...x, { kind: 'user', text: t }])
    setText(''); setTags([]); setRunning(true)
    try { await window.pedit.sendChat(t, used) } catch (err) {
      setRunning(false)
      setItems((x) => [...x, { kind: 'system', text: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }])
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
  }

  const tagKey = (g: ChatTag): string => g.path ?? `${g.mediaId}:${g.name}`
  const addAttached = (got: ChatTag[]): void => {
    setTags((g) => [...g, ...got.filter((x) => !g.some((y) => tagKey(y) === tagKey(x)))])
    input.current?.focus()
  }
  const attachPaths = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    try {
      const got = await window.pedit.attachToChat(paths)
      if (got.some((g) => g.attached === 'story')) window.dispatchEvent(new Event('pedit-story'))
      if (!got.length) useUi.getState().showToast('Nothing to attach in what you dropped')
      addAttached(got)
    } catch (err) { useUi.getState().showToast((err as Error).message) }
  }
  const attachFiles = (files: FileList | File[] | null): void => {
    void attachPaths(Array.from(files ?? []).map((f) => window.pedit.pathForFile(f)).filter(Boolean))
  }
  const onPaste = (e: ClipboardEvent): void => {
    // files copied in a file manager have paths; a copied screenshot doesn't
    const withPath = Array.from(e.clipboardData.files).filter((f) => window.pedit.pathForFile(f))
    if (withPath.length) { e.preventDefault(); attachFiles(withPath); return }
    const img = Array.from(e.clipboardData.items).find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
    if (!img) return
    e.preventDefault()
    void img.arrayBuffer().then((b) => window.pedit.attachPastedImage(new Uint8Array(b))).then(addAttached, (err: Error) => useUi.getState().showToast(err.message))
  }

  // the whole panel takes drops: files from the desktop, or clips from the media library
  const accepts = (e: DragEvent): boolean => e.dataTransfer.types.includes(MEDIA_DRAG) || e.dataTransfer.types.includes('Files')
  const onDragEnter = (e: DragEvent): void => { if (accepts(e)) { e.preventDefault(); dragDepth.current++; setDropOver(true) } }
  const onDragOver = (e: DragEvent): void => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropOver(true) } }
  const onDragLeave = (): void => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropOver(false) }
  const onDrop = (e: DragEvent): void => {
    dragDepth.current = 0
    setDropOver(false)
    if (!e.dataTransfer.types.includes(MEDIA_DRAG) && e.dataTransfer.files.length) {
      e.preventDefault()
      attachFiles(e.dataTransfer.files)
      return
    }
    const id = e.dataTransfer.getData(MEDIA_DRAG)
    const m = media.find((x) => x.id === id)
    if (!m) return
    e.preventDefault()
    setTags((g) => (g.some((x) => !x.attached && x.mediaId === id) ? g : [...g, { name: m.name, mediaId: id }]))
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.name} `)
    input.current?.focus()
  }

  // consecutive tool steps show as one activity group; Claude's name starts each reply
  type Group = { kind: 'steps'; steps: Array<Extract<Item, { kind: 'step' }>>; key: number; first: boolean } | { kind: 'item'; it: Item; key: number; first: boolean }
  const blocks: Group[] = []
  items.forEach((it, i) => {
    const last = blocks[blocks.length - 1]
    const lastKind = last ? (last.kind === 'steps' ? 'step' : last.it.kind) : 'user'
    const first = (it.kind === 'step' || it.kind === 'assistant') && (lastKind === 'user' || lastKind === 'system')
    if (it.kind === 'step' && last?.kind === 'steps') last.steps.push(it)
    else if (it.kind === 'step') blocks.push({ kind: 'steps', steps: [it], key: i, first })
    else blocks.push({ kind: 'item', it, key: i, first })
  })
  const waiting = running && !items.some((x) => x.kind === 'step' && x.running)
  const lastKind = items.length ? items[items.length - 1].kind : 'user'

  return (
    <div data-testid="chat" className="panel relative flex min-h-0 flex-col !p-0" style={{ gridRow: '2 / 4', gridColumn: '4' }}
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="flex items-center gap-2 border-b border-[#2a2a31] px-3.5 py-2.5">
        <ClaudeMark />
        <span className="text-[13px] font-semibold text-neutral-100">Claude</span>
        {running && <span data-testid="chat-working" className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-400"><span className="chat-pulse" aria-hidden="true" />Working</span>}
      </div>
      {status && !status.ok && (
        <div data-testid="claude-banner" className="mx-3 mt-2.5 rounded-lg border border-amber-700/40 bg-amber-900/25 px-3 py-2 text-[11.5px] leading-snug text-amber-100">
          Claude Code was not found. Install it, run <code className="rounded bg-black/30 px-1">claude</code> once to log in, then restart pedit.
        </div>
      )}
      <div ref={list} data-testid="chat-list" className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-[13px] leading-[1.6] text-neutral-200"
        onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {items.length === 0 && (
          <div data-testid="chat-empty" className="flex min-h-full flex-col justify-center gap-3 pb-6">
            <div className="flex items-center gap-2"><ClaudeMark size={18} /><span className="text-[15px] font-medium text-neutral-100">What should we make?</span></div>
            <p className="text-[12px] leading-relaxed text-neutral-500">Describe the edit, and Claude builds it as a draft you can preview, accept or reject. Drag clips here to point at them, or drop in photos, music, a story or any other file.</p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} data-testid="chat-suggestion" className="rounded-lg border border-[#2f2f37] px-3 py-2 text-left text-[12px] text-neutral-300 transition-colors hover:border-[#3d3d47] hover:bg-[#26262c] hover:text-neutral-100"
                  onClick={() => { setText(s); input.current?.focus() }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3.5">
          {blocks.map((b) => {
            const mark = b.first ? <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-400"><ClaudeMark size={12} />Claude</div> : null
            if (b.kind === 'steps') return <div key={b.key}>{mark}<Steps steps={b.steps} /></div>
            const it = b.it
            if (it.kind === 'user') return <div key={b.key} data-testid="chat-msg-user" className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#2e2e36] px-3.5 py-2 text-neutral-100">{it.text}</div>
            if (it.kind === 'assistant') return <div key={b.key}>{mark}<AssistantMessage text={it.text} /></div>
            return (
              <div key={b.key} data-testid="chat-msg-system" role="alert" className="flex gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-[12px] leading-snug text-amber-100">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-px flex-none text-amber-300" aria-hidden="true"><path d="M8 1.8 15 14H1z" /><path d="M8 6.5v3.5M8 12v.01" /></svg>
                <span className="min-w-0"><InlineText text={it.text} /></span>
              </div>
            )
          })}
          {waiting && (
            <div data-testid="chat-thinking" className="flex items-center gap-2 text-[12px] text-neutral-400">
              {lastKind === 'user' ? <ClaudeMark size={12} /> : null}
              <span className="chat-dots" aria-hidden="true"><i /><i /><i /></span>Thinking
            </div>
          )}
        </div>
      </div>
      <div className="px-3 pb-3 pt-1">
        <DraftBar />
        <div className="rounded-2xl border border-[#34343c] bg-[#26262c] transition-colors focus-within:border-[#4a4a55]">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
              {tags.map((g) => (
                <span key={tagKey(g)} data-testid="chat-chip" title={g.attached ? CHIP_TITLE[g.attached] : 'Clip you pointed at'}
                  className="flex h-6 items-center gap-1.5 rounded-md border border-[#3a3a43] bg-[#2e2e36] pl-2 pr-1 text-[11.5px] text-neutral-200">
                  <span className="text-neutral-400"><ChipIcon tag={g} /></span>
                  <span className="max-w-[150px] truncate">{g.name}</span>
                  <button className="flex h-4 w-4 items-center justify-center rounded text-neutral-500 hover:bg-white/10 hover:text-neutral-200" aria-label={`Remove ${g.name}`}
                    onClick={() => setTags((x) => x.filter((y) => tagKey(y) !== tagKey(g)))}>
                    <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="m1 1 6 6M7 1 1 7" /></svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea ref={input} data-testid="chat-input" rows={1} disabled={running} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
            placeholder={running ? 'Claude is working…' : items.length ? 'Reply to Claude…' : 'Describe the edit you want…'}
            className="block max-h-[180px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60" />
          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            <input ref={fileInput} data-testid="chat-attach-input" type="file" multiple className="hidden"
              onChange={(e) => { attachFiles(e.target.files); e.target.value = '' }} />
            <button data-testid="chat-attach" className="chat-tool-btn w-7 justify-center"
              title="Attach files: videos, photos, music, a story, or any other file" aria-label="Attach files" disabled={running} onClick={() => fileInput.current?.click()}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m13.5 7.5-5.3 5.3a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.7 11.3a1.1 1.1 0 0 1-1.5-1.5L10.4 4.6" /></svg>
            </button>
            <ClaudePicker />
            {running
              ? <button data-testid="chat-stop" title="Stop" aria-label="Stop" className="ml-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-neutral-200 text-neutral-900 hover:bg-white" onClick={() => window.pedit.stopChat()}>
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg></button>
              : <button data-testid="chat-send" title="Send (Enter) · new line (Shift+Enter)" aria-label="Send" className="ml-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#d97757] text-white hover:bg-[#e0866a] disabled:bg-[#33333b] disabled:text-neutral-500" disabled={!text.trim()} onClick={() => void send()}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" /></svg></button>}
          </div>
        </div>
      </div>
      {dropOver && (
        <div data-testid="chat-drop" className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#d97757]/70 bg-[#1f1f23]/90 text-center">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#d97757" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 11v2.5h11V11" /></svg>
          <div className="text-[13px] font-medium text-neutral-100">Drop to attach</div>
          <div className="px-6 text-[11.5px] text-neutral-400">Clips, photos, music, a story, or any other file</div>
        </div>
      )}
    </div>
  )
}

/** Claude's text, formatted, with a Copy button that shows on hover. */
function AssistantMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group">
      <div data-testid="chat-msg-assistant" className="break-words"><Markdown text={text} /></div>
      <div className="mt-0.5 flex h-5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button className="rounded px-1.5 text-[11px] text-neutral-500 hover:bg-white/5 hover:text-neutral-200" aria-label="Copy message"
          onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }) }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  )
}

/** A run of tool steps: a summary line you can fold, then a quiet list; long runs fold to the last few. */
function Steps({ steps }: { steps: Array<Extract<Item, { kind: 'step' }>> }) {
  const [shut, setShut] = useState(false)
  const [all, setAll] = useState(false)
  const FOLD = 4
  const live = steps.some((s) => s.running)
  const edits = steps.filter((s) => !s.dim).length
  const failed = steps.filter((s) => s.text.startsWith('✗')).length
  const hidden = !all && steps.length > FOLD ? steps.length - (FOLD - 1) : 0
  const shown = hidden ? steps.slice(hidden) : steps
  const summary = live ? 'Working' : [`${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`, ...(edits ? [`${edits} ${edits === 1 ? 'edit' : 'edits'}`] : []), ...(failed ? [`${failed} failed`] : [])].join(' · ')
  return (
    <div className="rounded-lg border border-[#2c2c33] bg-[#1b1b1f]">
      <button className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11.5px] text-neutral-400 hover:text-neutral-200" aria-expanded={!shut} onClick={() => setShut((x) => !x)}>
        {live ? <span className="chat-spin" /> : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ transform: shut ? 'rotate(-90deg)' : undefined, transition: 'transform .12s' }}><path d="m2 3.5 3 3 3-3" /></svg>
        )}
        <span>{summary}</span>
      </button>
      {!shut && (
        <div className="border-t border-[#2c2c33] px-2.5 py-1.5 text-[11.5px] leading-snug">
          {hidden > 0 && <button className="mb-1 text-neutral-500 hover:text-neutral-300" onClick={() => setAll(true)}>Show {hidden} earlier steps</button>}
          {shown.map((it, i) => {
            const bad = it.text.startsWith('✗')
            return (
              <div key={i} data-testid="chat-step" className={`flex items-start gap-1.5 py-[3px] ${it.running ? 'text-neutral-200' : bad ? 'text-red-300' : it.dim ? 'text-neutral-500' : 'text-neutral-300'}`}>
                {it.running ? <span className="chat-spin mt-[3px]" /> : null}
                <span className="min-w-0 break-words">{it.running ? `${it.text}…` : it.text}</span>
              </div>
            )
          })}
          {all && steps.length > FOLD && <button className="mt-1 text-neutral-500 hover:text-neutral-300" onClick={() => setAll(false)}>Show fewer</button>}
        </div>
      )}
    </div>
  )
}

const MODEL_LABEL: Record<Settings['claudeModel'], string> = { default: 'Default model', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }

/** Which Claude model and how hard it thinks; saved right away, used from the next message. */
function ClaudePicker() {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { void window.pedit.getSettings().then(setS) }, [])
  if (!s) return <span className="flex-1" />
  const save = (patch: Partial<Settings>): void => { setS({ ...s, ...patch }); void window.pedit.setSettings(patch).then(setS) }
  return (
    <span className="ml-auto flex min-w-0 items-center gap-0.5">
      <EffortPicker value={s.claudeEffort} onChange={(e) => save({ claudeEffort: e })} />
      <Select testid="claude-model" size="sm" title="Claude model (from your next message)" className="max-w-[118px] !bg-transparent text-neutral-300 hover:!bg-[#33333b]"
        value={s.claudeModel} onChange={(m) => save({ claudeModel: m })}
        options={CLAUDE_MODELS.map((m) => ({ value: m, label: MODEL_LABEL[m] }))} />
    </span>
  )
}

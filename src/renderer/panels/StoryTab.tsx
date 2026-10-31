import { useEffect, useRef, useState } from 'react'
import { useUi } from '../store'

/** The project's story (story.md): what the video is about. Claude reads it before planning an edit. */
export function StoryTab() {
  const projectId = useUi((s) => s.project?.id)
  const [text, setText] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const load = (): void => { void window.pedit.getStory().then(setText) }
  useEffect(load, [projectId])
  // a story attached in chat updates this tab too
  useEffect(() => { window.addEventListener('pedit-story', load); return () => window.removeEventListener('pedit-story', load) }, [])
  const save = (t: string): void => {
    setText(t)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void window.pedit.setStory(t), 400)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <div className="flex h-full flex-col gap-2 p-1">
      <div className="text-[11px] leading-snug text-neutral-400">
        Tell Claude what this video is about: the order, the mood, the moments that must be in it. Claude reads this before it edits.
      </div>
      <textarea data-testid="story-text" value={text ?? ''} onChange={(e) => save(e.target.value)} placeholder={'# My trip\n\nOpen on the drive at dawn…'}
        className="min-h-40 flex-1 resize-none rounded-lg border border-white/10 bg-neutral-900/70 p-2 font-mono text-[11px] leading-relaxed text-neutral-100 outline-none focus:border-sky-500/60" />
      <input ref={file} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => { save(t); useUi.getState().showToast(`Story loaded from ${f.name}`) }); e.target.value = '' }} />
      <button className="btn" onClick={() => file.current?.click()}>Load a .md file…</button>
    </div>
  )
}

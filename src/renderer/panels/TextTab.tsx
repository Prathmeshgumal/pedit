import { useEffect, useState } from 'react'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/model'
import type { TextPreset } from '@shared/textPresets'
import { edit, useUi } from '../store'
import { useLibrary } from '../library'
import { ensureFont } from '../text/fonts'
import { playheadMs } from '../timeline/actions'

/** CSS for showing a text style on a small card (an approximation of the canvas drawing). */
export function styleCss(s: Partial<TextStyle>, families: string): React.CSSProperties {
  const o = s.outline === undefined ? (s.background ? null : { color: 'rgba(0,0,0,.85)', width: 1 }) : s.outline
  const shadows = [
    ...(o ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => `${x * Math.max(1, o.width / 3)}px ${y * Math.max(1, o.width / 3)}px 0 ${o.color}`) : []),
    ...(s.shadow ? [`0 2px 6px ${s.shadow}`] : [])
  ]
  return {
    fontFamily: families, fontWeight: s.bold ? 700 : 400, color: s.color ?? '#fff', letterSpacing: `${s.letterSpacing ?? 0}em`,
    textTransform: s.uppercase ? 'uppercase' : 'none', textShadow: shadows.join(', ') || undefined,
    background: s.background ?? undefined, padding: s.background ? '1px 6px' : undefined, borderRadius: 4
  }
}

/** Add a text and select it, so Properties shows it right away. */
async function addText(text: string, style: Partial<TextStyle>): Promise<void> {
  const before = new Set(useUi.getState().project?.text.map((t) => t.id))
  if (!(await edit({ type: 'addText', text, startMs: playheadMs(), durationMs: 2000, style }))) return
  const r = await window.pedit.getState()
  const added = r?.view.text.find((t) => !before.has(t.id))
  if (added) useUi.getState().selectItem(added.id)
}

function useFamilies(font: string | undefined): string {
  const [f, setF] = useState(`"${font ?? 'Inter'}", Inter, sans-serif`)
  useEffect(() => { let alive = true; void ensureFont(font ?? 'Inter').then((x) => { if (alive) setF(x) }); return () => { alive = false } }, [font])
  return f
}

function StyleCard({ p }: { p: TextPreset }) {
  const families = useFamilies(p.style.font)
  const apply = (): void => {
    const sel = useUi.getState().selectedItemId
    const t = useUi.getState().project?.text.find((x) => x.id === sel)
    if (t) void edit({ type: 'updateText', id: t.id, style: p.style })
    else void addText(p.name, p.style)
  }
  return (
    <button data-testid={`text-style-${p.name}`} title={`${p.description}\nClick: add at the playhead, or restyle the selected text`} onClick={apply}
      className="flex h-16 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-neutral-700/60 bg-gradient-to-br from-neutral-800 to-neutral-900 px-1 hover:border-sky-500/70">
      <span className="max-w-full truncate text-[15px] leading-tight" style={styleCss(p.style, families)}>{p.name}</span>
      {p.source === 'user' && <span className="text-[9px] text-sky-400">saved</span>}
    </button>
  )
}

export function TextTab() {
  const lib = useLibrary()
  const [family, setFamily] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = (m: string): void => useUi.getState().showToast(m)
  const addGoogle = async (): Promise<void> => {
    if (!family.trim()) return
    setBusy(true)
    try { const f = await window.pedit.addFont(family.trim()); toast(`Added ${f.family}`); setFamily('') } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 p-1">
      <button data-testid="add-text" className="btn w-full" onClick={() => void addText('Your text', DEFAULT_TEXT_STYLE)}>＋ Add text at playhead</button>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Styles</div>
        <div className="grid grid-cols-2 gap-1.5">{lib.textStyles.map((p) => <StyleCard key={`${p.source}:${p.name}`} p={p} />)}</div>
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Fonts · {lib.fonts.length}</div>
        <div className="flex gap-1">
          <input data-testid="font-add-input" className="input min-w-0 flex-1" placeholder="Any Google Font, e.g. Bungee" value={family}
            onChange={(e) => setFamily(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addGoogle() }} />
          <button data-testid="font-add" className="btn" disabled={busy} onClick={() => void addGoogle()}>{busy ? '…' : 'Add'}</button>
        </div>
        <button className="btn mt-1 w-full" onClick={() => void window.pedit.pickFontFile().then((f) => { if (f) toast(`Added ${f.family}`) })}>Add a font file (.ttf/.otf)…</button>
      </div>
    </div>
  )
}

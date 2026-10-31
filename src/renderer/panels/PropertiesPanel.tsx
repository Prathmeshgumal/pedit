import { useEffect, useState } from 'react'
import { edit, fmtDur, useUi } from '../store'
import type { TextStyle } from '@shared/model'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mb-2 flex items-center gap-2 text-[11px] text-neutral-400"><span className="w-16 shrink-0">{label}</span>{children}</label>
}

function Volume({ id, volume }: { id: string; volume: number }) {
  const [v, setV] = useState(volume)
  useEffect(() => setV(volume), [volume])
  return (
    <Row label="Volume">
      <input data-testid="prop-volume" type="range" min={0} max={200} value={Math.round(v * 100)} className="flex-1"
        onChange={(e) => setV(Number(e.target.value) / 100)}
        onPointerUp={() => void edit({ type: 'setVolume', id, volume: v })} onKeyUp={() => void edit({ type: 'setVolume', id, volume: v })} />
      <span className="w-10 text-right">{Math.round(v * 100)}%</span>
    </Row>
  )
}

function TextProps({ id }: { id: string }) {
  const t = useUi((s) => s.project?.text.find((x) => x.id === id))
  const [draft, setDraft] = useState(t?.text ?? '')
  useEffect(() => setDraft(t?.text ?? ''), [t?.text])
  if (!t) return null
  const style = (s: Partial<TextStyle>): void => void edit({ type: 'updateText', id, style: s })
  return (
    <>
      <Row label="Text">
        <textarea data-testid="prop-text" className="min-h-12 flex-1 rounded bg-neutral-800 p-1 text-xs text-neutral-100" value={draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft.trim() && draft !== t.text) void edit({ type: 'updateText', id, text: draft }) }} />
      </Row>
      <Row label="Size"><input type="range" min={2} max={20} step={0.5} value={t.style.sizePct} className="flex-1" onChange={(e) => style({ sizePct: Number(e.target.value) })} /><span className="w-10 text-right">{t.style.sizePct}%</span></Row>
      <Row label="Color"><input type="color" value={t.style.color} onChange={(e) => style({ color: e.target.value })} /></Row>
      <Row label="Position">
        <select className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-100" value={t.style.position} onChange={(e) => style({ position: e.target.value as TextStyle['position'] })}>
          <option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option>
          <option value="custom">Custom (drag in preview)</option>
        </select>
      </Row>
      <Row label="Rotation"><input type="range" min={-180} max={180} value={t.style.rotation ?? 0} className="flex-1" onChange={(e) => style({ rotation: Number(e.target.value) })} /><span className="w-10 text-right">{t.style.rotation ?? 0}°</span></Row>
      <Row label="Bold"><input type="checkbox" checked={t.style.bold} onChange={(e) => style({ bold: e.target.checked })} /></Row>
      <Row label="Background">
        <input type="checkbox" checked={t.style.background !== null} onChange={(e) => style({ background: e.target.checked ? '#000000aa' : null })} />
        {t.style.background && <input type="color" value={t.style.background.slice(0, 7)} onChange={(e) => style({ background: e.target.value + 'aa' })} />}
      </Row>
      <div className="text-[10px] text-neutral-500">{fmtDur(t.startMs)} → {fmtDur(t.startMs + t.durationMs)}</div>
    </>
  )
}

export function PropertiesPanel() {
  const id = useUi((s) => s.selectedItemId)
  const project = useUi((s) => s.project)
  const v = project?.video.find((x) => x.id === id)
  const a = project?.audio.find((x) => x.id === id)
  const t = project?.text.find((x) => x.id === id)
  const clip = v ?? a
  const media = clip ? project!.media.find((m) => m.id === clip.mediaId) : undefined
  return (
    <div data-testid="properties" className="panel min-h-0 overflow-y-auto">
      <div className="panel-title">Properties</div>
      {!clip && !t && <div className="text-xs text-neutral-500">Select an item on the timeline.</div>}
      {clip && (
        <>
          <div className="mb-2 truncate text-xs text-neutral-200" title={media?.path}>{v ? '🎬' : '♪'} {media?.name}</div>
          <Volume id={clip.id} volume={clip.volume} />
          <Row label="In"><span className="text-neutral-200">{fmtDur(clip.inMs)}</span></Row>
          <Row label="Out"><span className="text-neutral-200">{fmtDur(clip.outMs)}</span></Row>
          <Row label="Length"><span className="text-neutral-200">{fmtDur(clip.outMs - clip.inMs)}</span></Row>
        </>
      )}
      {t && <TextProps id={t.id} />}
    </div>
  )
}

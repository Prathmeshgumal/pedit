import { useEffect, useState } from 'react'
import { edit, fmtDur, useUi } from '../store'
import { IDENTITY_TRANSFORM, TEXT_ANIMS, type TextAnim, type TextStyle } from '@shared/model'
import { useLibrary } from '../library'
import { promptDialog } from '../ContextMenu'
import { CropDialog } from './CropDialog'
import { mirrorSelected, rotateSelected } from '../timeline/actions'

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

const ANIM_LABEL: Record<TextAnim, string> = { none: 'None', fade: 'Fade', 'slide-up': 'Slide up', 'slide-down': 'Slide down', 'slide-left': 'Slide left', 'slide-right': 'Slide right', pop: 'Pop' }

function TextProps({ id }: { id: string }) {
  const lib = useLibrary()
  const t = useUi((s) => s.project?.text.find((x) => x.id === id))
  const [draft, setDraft] = useState(t?.text ?? '')
  useEffect(() => setDraft(t?.text ?? ''), [t?.text])
  if (!t) return null
  const style = (s: Partial<TextStyle>): void => void edit({ type: 'updateText', id, style: s })
  const outline = t.style.outline === undefined ? (t.style.background ? null : { color: '#000000', width: 1 }) : t.style.outline
  return (
    <>
      <Row label="Font">
        <select data-testid="prop-font" className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-neutral-100" value={t.style.font} onChange={(e) => style({ font: e.target.value })}>
          {!lib.fonts.some((f) => f.family === t.style.font) && <option value={t.style.font}>{t.style.font}</option>}
          {lib.fonts.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
        </select>
      </Row>
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
      <Row label="Outline">
        <input data-testid="prop-outline" type="checkbox" checked={outline !== null} onChange={(e) => style({ outline: e.target.checked ? { color: '#000000', width: 4 } : null })} />
        {outline && <>
          <input type="color" value={outline.color.slice(0, 7)} onChange={(e) => style({ outline: { ...outline, color: e.target.value } })} />
          <input type="range" min={1} max={16} value={outline.width} className="flex-1" onChange={(e) => style({ outline: { ...outline, width: Number(e.target.value) } })} />
        </>}
      </Row>
      <Row label="Shadow">
        <input data-testid="prop-shadow" type="checkbox" checked={!!t.style.shadow} onChange={(e) => style({ shadow: e.target.checked ? '#000000aa' : null })} />
        {t.style.shadow && <input type="color" value={t.style.shadow.slice(0, 7)} onChange={(e) => style({ shadow: e.target.value + 'cc' })} />}
      </Row>
      <Row label="Spacing"><input data-testid="prop-spacing" type="range" min={-5} max={50} value={Math.round((t.style.letterSpacing ?? 0) * 100)} className="flex-1" onChange={(e) => style({ letterSpacing: Number(e.target.value) / 100 })} /><span className="w-10 text-right">{Math.round((t.style.letterSpacing ?? 0) * 100)}</span></Row>
      <Row label="CAPS"><input data-testid="prop-caps" type="checkbox" checked={!!t.style.uppercase} onChange={(e) => style({ uppercase: e.target.checked })} /></Row>
      <Row label="Animate in">
        <select data-testid="prop-anim-in" className="flex-1 rounded bg-neutral-800 px-1 py-0.5 text-neutral-100" value={t.style.animIn ?? 'none'} onChange={(e) => style({ animIn: e.target.value as TextAnim })}>
          {TEXT_ANIMS.map((a) => <option key={a} value={a}>{ANIM_LABEL[a]}</option>)}
        </select>
      </Row>
      <Row label="Animate out">
        <select data-testid="prop-anim-out" className="flex-1 rounded bg-neutral-800 px-1 py-0.5 text-neutral-100" value={t.style.animOut ?? 'none'} onChange={(e) => style({ animOut: e.target.value as TextAnim })}>
          {TEXT_ANIMS.map((a) => <option key={a} value={a}>{ANIM_LABEL[a]}</option>)}
        </select>
      </Row>
      {(t.style.animIn && t.style.animIn !== 'none' || t.style.animOut && t.style.animOut !== 'none') && (
        <Row label="Anim length"><input type="range" min={100} max={2000} step={50} value={t.style.animMs ?? 400} className="flex-1" onChange={(e) => style({ animMs: Number(e.target.value) })} /><span className="w-10 text-right">{((t.style.animMs ?? 400) / 1000).toFixed(2)}s</span></Row>
      )}
      <div className="mb-2 flex gap-1">
        <select data-testid="prop-preset" className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-100" value="" onChange={(e) => {
          const p = lib.textStyles.find((x) => x.name === e.target.value)
          if (p) style(p.style)
        }}>
          <option value="">Apply a style…</option>
          {lib.textStyles.map((p) => <option key={`${p.source}:${p.name}`} value={p.name}>{p.name}</option>)}
        </select>
        <button data-testid="prop-save-style" className="btn" onClick={async () => {
          const name = await promptDialog('Save this look as a text style', '')
          if (!name?.trim()) return
          const { font, bold, sizePct, color, background, outline: ol, shadow, letterSpacing, uppercase, animIn, animOut, animMs } = t.style
          try { await window.pedit.saveTextStyle(name.trim(), '', { font, bold, sizePct, color, background, outline: ol, shadow, letterSpacing, uppercase, animIn, animOut, animMs }); useUi.getState().showToast(`Saved “${name.trim()}”`) }
          catch (e) { useUi.getState().showToast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
        }}>Save style</button>
      </div>
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
  const [crop, setCrop] = useState(false)
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
          {v && (
            <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-neutral-400">
              <span className="w-16 shrink-0">Framing</span>
              <button data-testid="prop-rotate" className="btn" title="Rotate 90°" onClick={rotateSelected}>⟳ {v.transform?.rotate ?? 0}°</button>
              <button data-testid="prop-mirror" className={`btn ${v.transform?.flipH ? 'ring-1 ring-sky-400' : ''}`} title="Mirror" onClick={mirrorSelected}>⇋</button>
              <button data-testid="prop-crop" className="btn" onClick={() => setCrop(true)}>Crop…</button>
              {v.transform && <button className="btn" onClick={() => void edit({ type: 'setTransform', id: v.id, transform: IDENTITY_TRANSFORM })}>Reset</button>}
            </div>
          )}
          {crop && v && <CropDialog itemId={v.id} onClose={() => setCrop(false)} />}
        </>
      )}
      {t && <TextProps id={t.id} />}
    </div>
  )
}

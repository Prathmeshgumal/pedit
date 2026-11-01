import { useEffect, useState } from 'react'
import { edit, fmtDur, useUi } from '../store'
import { IDENTITY_TRANSFORM, TEXT_ANIMS, type TextAnim, type TextStyle } from '@shared/model'
import { useLibrary } from '../library'
import type { Adjust } from '@shared/look'
import { DEFAULT_TRANSITION_MS, TRANSITIONS, transitionMs, type TransitionType } from '@shared/transitions'
import { audioCutAt } from '@shared/clipAudio'
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

/** A slider that shows its value while dragging and makes one edit when released. */
function Slider({ label, testid, value, min, max, step = 1, fmt = String, onCommit }: { label: string; testid?: string; value: number; min: number; max: number; step?: number; fmt?: (v: number) => string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  // read the input itself: on key-up the state from this render can be one step behind
  const commit = (e: { currentTarget: HTMLInputElement }): void => { const x = Number(e.currentTarget.value); if (x !== value) onCommit(x) }
  return (
    <Row label={label}>
      <input data-testid={testid} type="range" min={min} max={max} step={step} value={v} className="flex-1"
        onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onDoubleClick={() => onCommit(0)} />
      <span className="w-10 text-right">{fmt(v)}</span>
    </Row>
  )
}

const ADJ_ROWS: Array<{ key: keyof Adjust; label: string; min: number }> = [
  { key: 'exposure', label: 'Exposure', min: -100 }, { key: 'contrast', label: 'Contrast', min: -100 }, { key: 'highlights', label: 'Highlights', min: -100 },
  { key: 'shadows', label: 'Shadows', min: -100 }, { key: 'saturation', label: 'Saturation', min: -100 }, { key: 'vibrance', label: 'Vibrance', min: -100 },
  { key: 'temperature', label: 'Temp', min: -100 }, { key: 'tint', label: 'Tint', min: -100 }, { key: 'fade', label: 'Fade', min: 0 }, { key: 'vignette', label: 'Vignette', min: 0 }
]

/** The cut into this clip: its transition and J/L sound offset. */
function CutProps({ id }: { id: string }) {
  const p = useUi((s) => s.project)!
  const i = p.video.findIndex((x) => x.id === id)
  if (i <= 0) return null
  const v = p.video[i]
  const tr = v.transition
  const real = audioCutAt(p, i)
  const cut = v.audioCutMs ?? 0
  const hint = cut === 0 ? 'Sound and picture cut together. Drag left for a J-cut (this sound starts early), right for an L-cut (the last sound runs on).'
    : cut < 0 ? `J-cut: this clip's sound starts ${(-real / 1000).toFixed(1)}s before its picture.` : `L-cut: the previous clip's sound runs ${(real / 1000).toFixed(1)}s into this picture.`
  return (
    <div className="mb-2 border-t border-neutral-800 pt-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-300">Cut into this clip</div>
      <Row label="Transition">
        <select data-testid="prop-transition" className="input flex-1" value={tr?.type ?? ''}
          onChange={(e) => void edit({ type: 'setTransition', ids: [id], transition: e.target.value ? { type: e.target.value as TransitionType, durationMs: tr?.durationMs ?? DEFAULT_TRANSITION_MS } : null })}>
          <option value="">None (cut)</option>
          {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Row>
      {tr && <Slider label="Length" testid="prop-transition-ms" value={tr.durationMs} min={100} max={3000} step={100} fmt={(x) => `${(Math.min(x, transitionMs(p.video, i) || x) / 1000).toFixed(1)}s`}
        onCommit={(x) => void edit({ type: 'setTransition', ids: [id], transition: { type: tr.type, durationMs: x } })} />}
      <Slider label="Sound" testid="prop-audio-cut" value={v.audioCutMs ?? 0} min={-2000} max={2000} step={100}
        fmt={(x) => (x === 0 ? '0' : `${x < 0 ? 'J' : 'L'} ${(Math.abs(x) / 1000).toFixed(1)}`)}
        onCommit={(x) => void edit({ type: 'setAudioCut', id, ms: x })} />
      <div className="-mt-1 text-[10px] leading-snug text-neutral-500">{hint}{cut !== 0 && real !== cut ? ' (shortened: not enough footage or clip length)' : ''}</div>
    </div>
  )
}

function ColorProps({ id }: { id: string }) {
  const lib = useLibrary()
  const look = useUi((s) => s.project?.video.find((x) => x.id === id)?.look)
  const f = look?.filter
  return (
    <>
      <div className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-neutral-500">Colour</div>
      <Row label="Filter">
        <select data-testid="prop-filter" className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-neutral-100" value={f?.name ?? ''} onChange={(e) => {
          const p = lib.filters.find((x) => x.name === e.target.value)
          void edit({ type: 'setLook', ids: [id], filter: p ? { name: p.name, strength: f?.strength ?? 1, adjust: p.adjust, ...(p.lut ? { lut: p.lut } : {}) } : null })
        }}>
          <option value="">None</option>
          {f && !lib.filters.some((x) => x.name === f.name) && <option value={f.name}>{f.name}</option>}
          {lib.filters.map((p) => <option key={`${p.source}:${p.name}`} value={p.name}>{p.name}</option>)}
        </select>
      </Row>
      {f && <Slider label="Strength" testid="prop-filter-strength" value={Math.round(f.strength * 100)} min={0} max={100} fmt={(v) => `${v}%`} onCommit={(v) => void edit({ type: 'setLook', ids: [id], filter: { ...f, strength: v / 100 } })} />}
      {ADJ_ROWS.map((r) => (
        <Slider key={r.key} label={r.label} testid={`adj-${r.key}`} value={look?.adjust?.[r.key] ?? 0} min={r.min} max={100}
          onCommit={(v) => void edit({ type: 'setLook', ids: [id], adjust: { [r.key]: v } })} />
      ))}
      <div className="mb-2 flex gap-1">
        {look?.adjust && <button className="btn" onClick={() => void edit({ type: 'setLook', ids: [id], adjust: null })}>Reset colour</button>}
        <button data-testid="save-filter" className="btn" onClick={async () => {
          const name = await promptDialog('Save this clip’s colour as a filter', '')
          if (!name?.trim()) return
          // approximately the clip's whole look as one set of adjustments: the filter's scaled by strength, plus the clip's own
          const adjust: Adjust = {}
          for (const [k, val] of Object.entries(f?.adjust ?? {}) as Array<[keyof Adjust, number]>) adjust[k] = k.endsWith('Hue') ? val : Math.round(val * f!.strength)
          for (const [k, val] of Object.entries(look?.adjust ?? {}) as Array<[keyof Adjust, number]>) adjust[k] = k.endsWith('Hue') ? val : Math.max(-100, Math.min(100, (adjust[k] ?? 0) + val))
          try { await window.pedit.saveFilter(name.trim(), '', adjust); useUi.getState().showToast(`Saved filter “${name.trim()}”`) } catch (e) { useUi.getState().showToast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
        }}>Save as filter</button>
      </div>
    </>
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
          {v && <CutProps id={v.id} />}
          {v && <ColorProps id={v.id} />}
          {crop && v && <CropDialog itemId={v.id} onClose={() => setCrop(false)} />}
        </>
      )}
      {t && <TextProps id={t.id} />}
    </div>
  )
}

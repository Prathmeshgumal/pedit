import { useEffect, useRef, useState } from 'react'
import { useUi, edit } from '../store'
import { fmtTimecode } from '@shared/time'
import type { Aspect } from '@shared/model'
import { Player } from '../preview/player'
import { setPlayer } from '../preview/instance'
import { textLayers } from '../text/layers'
import { TextOverlay } from './TextOverlay'

export function PreviewPanel() {
  const view = useUi((s) => s.project)
  const clipId = useUi((s) => s.clipPreviewId)
  const clip = view?.media.find((m) => m.id === clipId) ?? null
  const progress = useUi((s) => (clipId ? s.progress[clipId] : undefined))
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<Player | null>(null)
  // which view is on the canvas: a clip key, 'timeline', or null; `loaded` only counts for the view we're showing now
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [aspect, setAspect] = useState(16 / 9)
  const panel = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const on = (): void => setFull(document.fullscreenElement === panel.current)
    document.addEventListener('fullscreenchange', on)
    const menu = (e: Event): void => { if ((e as CustomEvent<string>).detail === 'fullscreenPreview') toggleFull() }
    window.addEventListener('pedit-menu', menu)
    return () => { document.removeEventListener('fullscreenchange', on); window.removeEventListener('pedit-menu', menu) }
  }, [])
  const toggleFull = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void panel.current?.requestFullscreen()
  }

  useEffect(() => {
    const p = new Player(canvas.current!)
    player.current = p
    setPlayer(p)
    p.setTextRenderer(textLayers(() => p.requestRedraw()))
    ;(window as unknown as { __peditPlayer: Player }).__peditPlayer = p
    let last = 0
    const off = p.onTime((ms) => {
      const now = performance.now()
      if (p.isPlaying && now - last < 50) return // UI updates at ~20Hz while playing
      last = now; setT(ms); setPlaying(p.isPlaying); setDur(p.durationMs)
    })
    return () => { off(); setPlayer(null); p.destroy() }
  }, [])

  // clip preview (double-clicked media tile)
  const clipReady = clip?.status === 'ready' && !!clip.proxyPath
  const clipKey = clip && clipReady ? `${clip.id}:${clip.proxyPath}` : null
  const loaded = loadedFor !== null && loadedFor === (clipId ? clipKey : 'timeline')
  useEffect(() => {
    if (!clipId) return
    if (!clipKey || !clip) return
    let alive = true
    void player.current!.loadClip(clip).then(() => {
      if (!alive) return
      const s = player.current!.sourceSize
      setAspect(s.width / s.height); setDur(player.current!.durationMs); setLoadedFor(clipKey)
    }, (e) => console.error(e))
    return () => { alive = false }
  }, [clipId, clipKey])

  // timeline preview
  useEffect(() => {
    if (clipId || !view) return
    let alive = true
    void player.current!.setProject(view).then(() => {
      if (!alive) return
      setAspect(view.settings.width / view.settings.height); setDur(player.current!.durationMs); setLoadedFor('timeline')
    }, (e) => console.error(e))
    return () => { alive = false }
  }, [view, clipId])

  useEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => {
      const bw = el.clientWidth, bh = el.clientHeight
      const w = Math.min(bw, bh * aspect), h = w / aspect
      setSize({ w: Math.floor(w), h: Math.floor(h) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  useEffect(() => {
    if (!size.w) return
    const dpr = window.devicePixelRatio || 1
    player.current?.resize(Math.round(size.w * dpr), Math.round(size.h * dpr))
  }, [size, loaded])

  const empty = !clipId && !!view && view.video.length === 0 && view.text.length === 0
  return (
    <div ref={panel} data-testid="preview-panel" className={`panel flex min-h-0 flex-col ${full ? 'bg-black' : ''}`}>
      <div className="flex items-center gap-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-500">
        {clipId ? (
          <>
            <span>Clip: <span className="normal-case text-neutral-300">{clip?.name}</span></span>
            <button className="btn ml-auto normal-case" onClick={() => useUi.getState().previewClip(null)}>Back to timeline</button>
          </>
        ) : <span>Timeline</span>}
      </div>
      <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <div className="relative" style={{ width: size.w, height: size.h }}>
          <canvas data-testid="preview-canvas" data-loaded={loaded ? 'true' : 'false'} ref={canvas}
            style={{ width: size.w, height: size.h, visibility: loaded ? 'visible' : 'hidden', display: 'block' }} />
          {!clipId && loaded && <TextOverlay timeMs={t} width={size.w} height={size.h} />}
        </div>
        {(!loaded || empty) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
            {clipId && clip ? (clip.status === 'offline' ? 'Media offline' : clipReady ? 'Loading…'
              : `Preparing preview… ${progress?.stage === 'proxy' ? `${progress.pct}%` : ''}`)
              : 'Drag clips onto the timeline · double-click a clip to preview it'}
          </div>
        )}
      </div>
      {clipId && (
        <input data-testid="clip-scrub" type="range" className="mt-1 w-full accent-sky-500" min={0} max={dur || 1} step={1} value={t} disabled={!loaded}
          onChange={(e) => void player.current?.seek(Number(e.target.value))} />
      )}
      <div data-testid="player-bar" className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-1.5 text-[11px] text-neutral-400">
        <span data-testid="timecode" className="font-mono tabular-nums">
          <span className="text-neutral-100">{fmtTimecode(t, clipId ? (clip?.fps || 30) : (view?.settings.fps ?? 30))}</span>
          <span className="text-neutral-500"> | {fmtTimecode(dur, clipId ? (clip?.fps || 30) : (view?.settings.fps ?? 30))}</span>
        </span>
        <button data-testid="play" title="Play / pause (Space)" disabled={!loaded} onClick={() => player.current?.toggle()}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-900 hover:bg-white disabled:opacity-40">
          {playing ? <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor" /><rect x="7" y="1" width="3" height="10" fill="currentColor" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1 L11 6 L3 11 Z" fill="currentColor" /></svg>}
        </button>
        <span className="flex items-center justify-end gap-2">
          {view && !clipId && (
            <select data-testid="aspect" title="Video shape" className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-200" value={view.settings.aspect}
              onChange={(e) => void edit({ type: 'setFormat', aspect: e.target.value as Aspect })}>
              <option value="16:9">16:9 YouTube</option><option value="9:16">9:16 Reels</option><option value="1:1">1:1 Square</option>
            </select>
          )}
          <button data-testid="fullscreen" className="btn" title={full ? 'Exit full screen (Esc)' : 'Full screen'} onClick={toggleFull}>{full ? '⤡' : '⤢'}</button>
        </span>
      </div>
    </div>
  )
}

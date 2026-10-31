import { useEffect, useRef, useState } from 'react'
import { useUi, fmtDur } from '../store'
import { Player } from '../preview/player'
import { setPlayer } from '../preview/instance'

export function PreviewPanel() {
  const view = useUi((s) => s.project)
  const clipId = useUi((s) => s.clipPreviewId)
  const clip = view?.media.find((m) => m.id === clipId) ?? null
  const progress = useUi((s) => (clipId ? s.progress[clipId] : undefined))
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<Player | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [aspect, setAspect] = useState(16 / 9)

  useEffect(() => {
    const p = new Player(canvas.current!)
    player.current = p
    setPlayer(p)
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
  useEffect(() => {
    if (!clipId) return
    setLoaded(false)
    if (!clipKey || !clip) return
    let alive = true
    void player.current!.loadClip(clip).then(() => {
      if (!alive) return
      const s = player.current!.sourceSize
      setAspect(s.width / s.height); setDur(player.current!.durationMs); setLoaded(true)
    }, (e) => console.error(e))
    return () => { alive = false }
  }, [clipId, clipKey])

  // timeline preview
  useEffect(() => {
    if (clipId || !view) return
    let alive = true
    void player.current!.setProject(view).then(() => {
      if (!alive) return
      setAspect(view.settings.width / view.settings.height); setDur(player.current!.durationMs); setLoaded(true)
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
    <div data-testid="preview-panel" className="panel flex min-h-0 flex-col">
      <div className="flex items-center gap-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-500">
        {clipId ? (
          <>
            <span>Clip: <span className="normal-case text-neutral-300">{clip?.name}</span></span>
            <button className="btn ml-auto normal-case" onClick={() => useUi.getState().previewClip(null)}>Back to timeline</button>
          </>
        ) : <span>Timeline</span>}
      </div>
      <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <canvas data-testid="preview-canvas" data-loaded={loaded ? 'true' : 'false'} ref={canvas}
          style={{ width: size.w, height: size.h, visibility: loaded ? 'visible' : 'hidden' }} />
        {(!loaded || empty) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
            {clipId && clip ? (clip.status === 'offline' ? 'Media offline' : clipReady ? 'Loading…'
              : `Preparing preview… ${progress?.stage === 'proxy' ? `${progress.pct}%` : ''}`)
              : 'Drag clips onto the timeline · double-click a clip to preview it'}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 pt-1.5 text-[11px] text-neutral-400">
        <button className="btn w-8" disabled={!loaded} onClick={() => player.current?.toggle()}>{playing ? '❚❚' : '▶'}</button>
        <input type="range" className="flex-1 accent-sky-500" min={0} max={dur || 1} step={1} value={t} disabled={!loaded}
          onChange={(e) => void player.current?.seek(Number(e.target.value))} />
        <span className="tabular-nums">{fmtDur(t)} / {fmtDur(dur)}</span>
      </div>
    </div>
  )
}

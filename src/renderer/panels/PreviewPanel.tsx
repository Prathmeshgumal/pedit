import { useEffect, useRef, useState } from 'react'
import { useUi, fmtDur } from '../store'
import { Player } from '../preview/player'

export function PreviewPanel() {
  const media = useUi((s) => s.project?.media.find((m) => m.id === s.selectedMediaId) ?? null)
  const progress = useUi((s) => (s.selectedMediaId ? s.progress[s.selectedMediaId] : undefined))
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<Player | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [aspect, setAspect] = useState(16 / 9)

  useEffect(() => {
    const p = new Player(canvas.current!)
    player.current = p
    ;(window as unknown as { __peditPlayer: Player }).__peditPlayer = p
    let last = 0
    const off = p.onTime((ms) => {
      const now = performance.now()
      if (p.isPlaying && now - last < 50) return // UI updates at ~20Hz while playing
      last = now; setT(ms); setPlaying(p.isPlaying)
    })
    return () => { off(); p.destroy() }
  }, [])

  const ready = media?.status === 'ready' && !!media.proxyPath
  const key = ready ? `${media!.id}:${media!.proxyPath}` : null
  useEffect(() => {
    setLoaded(false)
    if (!key || !media) return
    let alive = true
    const a = media.width && media.height ? media.width / media.height : 16 / 9
    setAspect(a)
    void player.current!.loadClip(media).then(() => { if (alive) setLoaded(true) }, (e) => console.error(e))
    return () => { alive = false }
  }, [key])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input,textarea,[contenteditable]')) return
      e.preventDefault(); player.current?.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const dur = player.current?.durationMs ?? 0
  return (
    <div data-testid="preview-panel" className="panel flex min-h-0 flex-col">
      <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <canvas data-testid="preview-canvas" data-loaded={loaded ? 'true' : 'false'} ref={canvas}
          style={{ width: size.w, height: size.h, visibility: loaded ? 'visible' : 'hidden' }} />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
            {!media ? 'Select a clip to preview' : media.status === 'offline' ? 'Media offline' : ready ? 'Loading…'
              : `Preparing preview… ${progress?.stage === 'proxy' ? `${progress.pct}%` : ''}`}
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

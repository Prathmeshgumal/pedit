import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent, type WheelEvent } from 'react'
import { useUi, edit } from '../store'
import { getPlayer } from '../preview/instance'
import { CONTENT_H, HEADER_W, RULER_H, hitTest, snapMs, trackAt, xToMs, layoutTimeline, type LaidOut, type Track } from './layout'
import { drawPlayhead, drawTimeline, type DrawState } from './draw'
import { dragToCommand, snapCandidates, splitTarget, type Zone } from './interact'
import { timelineDurationMs } from '@shared/model'

type Drag =
  | { kind: 'scrub' }
  | { kind: 'item'; id: string; track: Track; zone: Zone; startX: number; dxMs: number; moved: boolean }

const MIN_ZOOM = 0.001 // px per ms (1px = 1s)
const MAX_ZOOM = 0.5

export function TimelineCanvas() {
  const session = useUi((s) => s.session)
  const selected = useUi((s) => s.selectedItemId)
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const layoutRef = useRef<LaidOut[]>([])
  const drag = useRef<Drag | null>(null)
  const [width, setWidth] = useState(800)
  const [pxPerMs, setPxPerMs] = useState(0.05)
  const [scrollMs, setScrollMs] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [ghost, setGhost] = useState<DrawState['ghost']>(null)
  const [dropHint, setDropHint] = useState<DrawState['dropHint']>(null)
  const [cursor, setCursor] = useState('default')
  const [tick, setTick] = useState(0)
  const fitted = useRef(false)

  const project = session?.view ?? null

  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(wrap.current!.clientWidth))
    ro.observe(wrap.current!)
    return () => ro.disconnect()
  }, [])

  // follow the player
  useEffect(() => {
    let off: (() => void) | undefined
    const id = setInterval(() => {
      const p = getPlayer()
      if (!p || off) return
      let last = 0
      off = p.onTime((ms) => {
        if (p.mode !== 'timeline') return
        const now = performance.now()
        if (p.isPlaying && now - last < 33) return // ~30Hz while playing keeps the main thread free for video
        last = now
        setPlayhead(ms)
      })
    }, 100)
    return () => { clearInterval(id); off?.() }
  }, [])

  // fit the timeline once when content first appears
  useEffect(() => {
    if (!project || fitted.current) return
    const d = timelineDurationMs(project)
    if (d > 0) { fitted.current = true; setPxPerMs(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, ((width - HEADER_W - 40) / d)))) }
  }, [project, width])

  // keep playhead visible while playing
  useEffect(() => {
    const visibleMs = (width - HEADER_W) / pxPerMs
    if (playhead > scrollMs + visibleMs * 0.95) setScrollMs(playhead - visibleMs * 0.1)
    else if (playhead < scrollMs) setScrollMs(Math.max(0, playhead - visibleMs * 0.1))
  }, [playhead])

  const redraw = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    const c = canvas.current!
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr); c.height = Math.round(CONTENT_H * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!project) { ctx.clearRect(0, 0, width, CONTENT_H); return }
    layoutRef.current = drawTimeline(ctx, width, {
      project, real: session?.draftActive ? session.real : null, diff: session?.diff ?? null,
      pxPerMs, scrollMs, selected, ghost, dropHint
    }, redraw)
  }, [project, session, width, pxPerMs, scrollMs, selected, ghost, dropHint, tick, redraw])

  useEffect(() => {
    const c = overlay.current!
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(width * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(CONTENT_H * dpr) }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawPlayhead(ctx, width, project ? playhead : -1e9, pxPerMs, scrollMs)
  }, [playhead, width, pxPerMs, scrollMs, project])

  // expose layout for end-to-end tests
  useEffect(() => {
    ;(window as unknown as { __peditTimeline: unknown }).__peditTimeline = {
      items: () => {
        const r = canvas.current!.getBoundingClientRect()
        const tracks = { text: [6, 26], video: [38, 58], audio: [102, 38] } as const
        return layoutRef.current.map((i) => ({ ...i, left: r.left + i.x, right: r.left + i.x + i.w, cy: r.top + RULER_H + tracks[i.track][0] + tracks[i.track][1] / 2 }))
      },
      trackY: (t: Track) => { const r = canvas.current!.getBoundingClientRect(); return r.top + RULER_H + ({ text: 19, video: 67, audio: 121 } as const)[t] },
      left: () => canvas.current!.getBoundingClientRect().left + HEADER_W
    }
  })

  const seekTo = (x: number): void => {
    const ms = Math.max(0, xToMs(x, pxPerMs, scrollMs))
    useUi.getState().previewClip(null)
    void getPlayer()?.seek(ms)
    setPlayhead(Math.min(ms, project ? timelineDurationMs(project) : 0))
  }

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (!project) return
    const { x, y } = local(e)
    canvas.current!.setPointerCapture(e.pointerId)
    if (y < RULER_H) { drag.current = { kind: 'scrub' }; seekTo(x); return }
    const hit = hitTest(layoutRef.current, x, y)
    if (!hit) { useUi.getState().selectItem(null); if (x > HEADER_W) seekTo(x); return }
    useUi.getState().selectItem(hit.id)
    const track = layoutRef.current.find((i) => i.id === hit.id)!.track
    drag.current = { kind: 'item', id: hit.id, track, zone: hit.zone, startX: x, dxMs: 0, moved: false }
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!project) return
    const { x, y } = local(e)
    const d = drag.current
    if (!d) {
      const hit = y >= RULER_H ? hitTest(layoutRef.current, x, y) : null
      setCursor(hit ? (hit.zone === 'body' ? 'grab' : 'ew-resize') : y < RULER_H ? 'pointer' : 'default')
      return
    }
    if (d.kind === 'scrub') { seekTo(x); return }
    if (!d.moved && Math.abs(x - d.startX) < 3) return
    d.moved = true
    const it = layoutRef.current.find((i) => i.id === d.id)
    if (!it) return
    let dxMs = (x - d.startX) / pxPerMs
    const cands = snapCandidates(project, d.id, playhead)
    const edgeMs = d.zone === 'right-edge' ? it.endMs : it.startMs
    dxMs = snapMs(edgeMs + dxMs, cands, 8, pxPerMs) - edgeMs
    d.dxMs = dxMs
    setGhost({ id: d.id, dxMs, ...(d.zone === 'body' ? {} : { trim: d.zone }) })
  }

  const onPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    setGhost(null)
    if (!d || d.kind !== 'item' || !d.moved || !project) return
    const cmd = dragToCommand(project, d.id, d.track, d.zone, d.dxMs)
    if (cmd) void edit(cmd)
  }

  const onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      const { x } = local(e)
      const at = xToMs(x, pxPerMs, scrollMs)
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pxPerMs * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
      setPxPerMs(z)
      setScrollMs(Math.max(0, at - (x - HEADER_W) / z))
    } else {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      setScrollMs((s) => Math.max(0, s + delta / pxPerMs))
    }
  }

  const dropTarget = (e: DragEvent): { track: Track; ms: number } | null => {
    if (!e.dataTransfer.types.includes('application/x-pedit-media')) return null
    const { x, y } = local(e)
    const track = trackAt(y)
    if (!track || track === 'text') return null
    return { track, ms: Math.max(0, xToMs(x, pxPerMs, scrollMs)) }
  }

  const onDragOver = (e: DragEvent): void => {
    const t = dropTarget(e)
    if (t) { e.preventDefault(); setDropHint(t) } else setDropHint(null)
  }

  const onDrop = (e: DragEvent): void => {
    const t = dropTarget(e)
    setDropHint(null)
    if (!t) return
    e.preventDefault()
    const mediaId = e.dataTransfer.getData('application/x-pedit-media')
    useUi.getState().previewClip(null)
    if (t.track === 'video') void edit({ type: 'addClip', mediaId, atMs: Math.round(t.ms) })
    else void edit({ type: 'setMusic', mediaId })
  }

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return
      const s = useUi.getState()
      const p = s.session?.view
      const player = getPlayer()
      const mod = e.ctrlKey || e.metaKey
      if (e.code === 'Space') { e.preventDefault(); player?.toggle(); return }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); void (e.shiftKey ? window.pedit.redo() : window.pedit.undo()); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); void window.pedit.redo(); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); s.showToast('Saved'); return }
      if (mod || !p) return
      const t = player?.mode === 'timeline' ? player.timeMs : 0
      if (e.key === 's' || e.key === 'S') {
        const id = splitTarget(p, s.selectedItemId, t)
        if (id) void edit({ type: 'splitItem', id, atMs: Math.round(t) })
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedItemId) {
        void edit({ type: 'removeItem', id: s.selectedItemId }); s.selectItem(null)
      } else if (e.key === 'k' || e.key === 'K') player?.pause()
      else if (e.key === 'l' || e.key === 'L') player?.play()
      else if (e.key === 'j' || e.key === 'J') void player?.seek(Math.max(0, t - 2000))
      else if (e.key === 'ArrowLeft') void player?.seek(Math.max(0, t - (e.shiftKey ? 1000 : 1000 / (p.settings.fps))))
      else if (e.key === 'ArrowRight') void player?.seek(t + (e.shiftKey ? 1000 : 1000 / p.settings.fps))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div data-testid="timeline" className="panel flex min-h-0 flex-col" style={{ gridColumn: '1 / 4' }}>
      <div className="flex items-center gap-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-500">
        <span>Timeline</span>
        {session?.draftActive && <span className="rounded bg-violet-500/30 px-1.5 normal-case text-violet-200">Showing Claude's draft</span>}
        <span className="ml-auto normal-case">S split · Del delete · Ctrl+wheel zoom</span>
        <button className="btn normal-case" onClick={() => setPxPerMs((z) => Math.min(MAX_ZOOM, z * 1.5))}>＋</button>
        <button className="btn normal-case" onClick={() => setPxPerMs((z) => Math.max(MIN_ZOOM, z / 1.5))}>－</button>
        <button className="btn normal-case" onClick={() => { if (project) { const d = timelineDurationMs(project); if (d) { setPxPerMs(Math.min(MAX_ZOOM, (width - HEADER_W - 40) / d)); setScrollMs(0) } } }}>Fit</button>
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas ref={overlay} className="pointer-events-none absolute left-0 top-0" style={{ width, height: CONTENT_H }} />
        <canvas ref={canvas} data-testid="timeline-canvas" style={{ width, height: CONTENT_H, cursor, display: 'block' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onWheel={onWheel} onDragOver={onDragOver} onDragLeave={() => setDropHint(null)} onDrop={onDrop} />
        {project && project.video.length === 0 && project.audio.length === 0 && project.text.length === 0 && (
          <div className="pointer-events-none -mt-24 text-center text-xs text-neutral-500">Drag clips here from the media panel</div>
        )}
      </div>
    </div>
  )
}

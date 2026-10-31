import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type WheelEvent } from 'react'
import { useUi, edit } from '../store'
import { getPlayer } from '../preview/instance'
import { HEADER_W, RULER_H, contentHeight, hitTest, rowAt, snapMs, trackRows, xToMs, type LaidOut, type Track, type TrackRow } from './layout'
import { drawPlayhead, drawTimeline, type DrawState } from './draw'
import { dragToCommand, snapCandidates, type Zone } from './interact'
import { Toolbar, MIN_ZOOM, MAX_ZOOM } from './Toolbar'
import { deleteSelected, deleteSide, splitAtPlayhead, selectedClip, canAct } from './actions'
import { itemMenu, freezeAtPlayhead } from './clipMenu'
import { openMenu } from '../ContextMenu'
import { CropDialog } from '../panels/CropDialog'
import { timelineDurationMs } from '@shared/model'

type Drag =
  | { kind: 'scrub' }
  | { kind: 'item'; id: string; track: Track; zone: Zone; startX: number; dxMs: number; moved: boolean }


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
  const [cropFor, setCropFor] = useState<string | null>(null)

  const project = session?.view ?? null
  const rows = useMemo(() => (project ? trackRows(project) : []), [project])
  const rowsRef = useRef<TrackRow[]>([])
  rowsRef.current = rows
  const H = rows.length ? contentHeight(rows) : 168

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
    c.width = Math.round(width * dpr); c.height = Math.round(H * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!project) { ctx.clearRect(0, 0, width, H); return }
    layoutRef.current = drawTimeline(ctx, width, {
      project, real: session?.draftActive ? session.real : null, diff: session?.diff ?? null,
      pxPerMs, scrollMs, selected, ghost, dropHint, rows, height: H
    }, redraw)
  }, [project, session, width, pxPerMs, scrollMs, selected, ghost, dropHint, tick, redraw, rows, H])

  useEffect(() => {
    const c = overlay.current!
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(H * dpr) }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawPlayhead(ctx, width, H, project ? playhead : -1e9, pxPerMs, scrollMs)
  }, [playhead, width, pxPerMs, scrollMs, project, H])

  // expose layout for end-to-end tests
  useEffect(() => {
    ;(window as unknown as { __peditTimeline: unknown }).__peditTimeline = {
      items: () => {
        const r = canvas.current!.getBoundingClientRect()
        const row = (k: string): TrackRow => rowsRef.current.find((x) => x.key === k)!
        return layoutRef.current.map((i) => ({ ...i, left: r.left + i.x, right: r.left + i.x + i.w, cy: r.top + RULER_H + row(i.row).y + row(i.row).h / 2 }))
      },
      trackY: (t: Track) => rowY(t === 'audio' ? 'audio:0' : t),
      rowY,
      rows: () => rowsRef.current.map((x) => x.key),
      left: () => canvas.current!.getBoundingClientRect().left + HEADER_W
    }
  })

  function rowY(key: string): number {
    const r = canvas.current!.getBoundingClientRect()
    const row = rowsRef.current.find((x) => x.key === key)
    return row ? r.top + RULER_H + row.y + row.h / 2 : NaN
  }

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
    const hit = hitTest(layoutRef.current, rowsRef.current, x, y)
    if (!hit) { useUi.getState().selectItem(null); if (x > HEADER_W) seekTo(x); return }
    useUi.getState().selectItem(hit.id)
    const track = layoutRef.current.find((i) => i.id === hit.id)!.track
    drag.current = { kind: 'item', id: hit.id, track, zone: hit.zone, startX: x, dxMs: 0, moved: false }
  }

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    if (!project) return
    const { x, y } = local(e)
    const hit = y >= RULER_H ? hitTest(layoutRef.current, rowsRef.current, x, y) : null
    if (!hit) return
    useUi.getState().selectItem(hit.id)
    openMenu(e, itemMenu(project, hit.id, setCropFor))
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!project) return
    const { x, y } = local(e)
    const d = drag.current
    if (!d) {
      const hit = y >= RULER_H ? hitTest(layoutRef.current, rowsRef.current, x, y) : null
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
    if (useUi.getState().snapping) dxMs = snapMs(edgeMs + dxMs, cands, 8, pxPerMs) - edgeMs
    d.dxMs = dxMs
    setGhost({ id: d.id, dxMs, ...(d.zone === 'body' ? {} : { trim: d.zone }) })
  }

  const onPointerUp = (e: PointerEvent): void => {
    const d = drag.current
    drag.current = null
    setGhost(null)
    if (!d || d.kind !== 'item' || !d.moved || !project) return
    // audio dragged onto another audio row changes lane
    const over = d.track === 'audio' && d.zone === 'body' ? rowAt(rowsRef.current, local(e).y) : null
    const lane = over?.kind === 'audio' ? over.lane : undefined
    const cmd = dragToCommand(project, d.id, d.track, d.zone, d.dxMs, lane)
    if (cmd) void edit(cmd)
  }

  const canSplit = canAct(project, selected, playhead).split
  const onFreeze = useCallback(() => { const c = selectedClip(); if (c) void freezeAtPlayhead(c.id) }, [])
  const onCrop = useCallback(() => { const c = selectedClip(); if (c) setCropFor(c.id) }, [])
  const fit = useCallback(() => {
    const p = useUi.getState().session?.view
    const d = p ? timelineDurationMs(p) : 0
    if (d) { setPxPerMs(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (width - HEADER_W - 40) / d))); setScrollMs(0) }
  }, [width])

  /** Zoom keeping the playhead where it is on screen. */
  const playheadRef = useRef(0)
  playheadRef.current = playhead
  const zoomAround = useCallback((z: number): void => {
    const x = HEADER_W + (playheadRef.current - scrollMs) * pxPerMs
    const anchor = x >= HEADER_W && x <= width ? x : HEADER_W
    const at = xToMs(anchor, pxPerMs, scrollMs)
    setPxPerMs(z)
    setScrollMs(Math.max(0, at - (anchor - HEADER_W) / z))
  }, [pxPerMs, scrollMs, width])

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

  const dropTarget = (e: DragEvent): { row: TrackRow; ms: number } | null => {
    if (!e.dataTransfer.types.includes('application/x-pedit-media')) return null
    const { x, y } = local(e)
    const row = rowAt(rowsRef.current, y)
    if (!row || row.kind === 'text') return null
    return { row, ms: Math.max(0, xToMs(x, pxPerMs, scrollMs)) }
  }

  const onDragOver = (e: DragEvent): void => {
    const t = dropTarget(e)
    if (t) { e.preventDefault(); setDropHint({ row: t.row.key, ms: t.ms }) } else setDropHint(null)
  }

  const onDrop = (e: DragEvent): void => {
    const t = dropTarget(e)
    setDropHint(null)
    if (!t) return
    e.preventDefault()
    const mediaId = e.dataTransfer.getData('application/x-pedit-media')
    useUi.getState().previewClip(null)
    if (t.row.kind === 'video') void edit({ type: 'addClip', mediaId, atMs: Math.round(t.ms) })
    else if (t.row.lane === 0 && !project?.audio.length) void edit({ type: 'setMusic', mediaId })
    else void edit({ type: 'addAudio', mediaId, startMs: Math.round(t.ms), lane: t.row.lane })
  }

  // View menu zoom items
  useEffect(() => {
    const on = (e: Event): void => {
      const a = (e as CustomEvent<string>).detail
      if (a === 'zoomIn') setPxPerMs((z) => Math.min(MAX_ZOOM, z * 1.5))
      else if (a === 'zoomOut') setPxPerMs((z) => Math.max(MIN_ZOOM, z / 1.5))
    }
    window.addEventListener('pedit-menu', on)
    return () => window.removeEventListener('pedit-menu', on)
  }, [])

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
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); splitAtPlayhead(); return }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setPxPerMs((z) => Math.min(MAX_ZOOM, z * 1.5)); return }
      if (mod && e.key === '-') { e.preventDefault(); setPxPerMs((z) => Math.max(MIN_ZOOM, z / 1.5)); return }
      if (mod || !p) return
      const t = player?.mode === 'timeline' ? player.timeMs : 0
      const k = e.key.toLowerCase()
      if (k === 's') splitAtPlayhead()
      else if (k === 'q') deleteSide('left')
      else if (k === 'w') deleteSide('right')
      else if (k === 'n') s.setSnapping(!s.snapping)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedItemId) deleteSelected()
      else if (e.key === 'k' || e.key === 'K') player?.pause()
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
      <Toolbar canSplit={canSplit} pxPerMs={pxPerMs} setZoom={zoomAround} onFreeze={onFreeze} onCrop={onCrop} fit={fit} />
      <div ref={wrap} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <canvas ref={overlay} className="pointer-events-none absolute left-0 top-0" style={{ width, height: H }} />
        <canvas ref={canvas} data-testid="timeline-canvas" style={{ width, height: H, cursor, display: 'block' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onContextMenu={onContextMenu} onWheel={onWheel} onDragOver={onDragOver} onDragLeave={() => setDropHint(null)} onDrop={onDrop} />
        {project && project.video.length === 0 && project.audio.length === 0 && project.text.length === 0 && (
          <div className="pointer-events-none -mt-24 text-center text-xs text-neutral-500">Drag clips here from the media panel</div>
        )}
        {cropFor && <CropDialog itemId={cropFor} onClose={() => setCropFor(null)} />}
      </div>
    </div>
  )
}

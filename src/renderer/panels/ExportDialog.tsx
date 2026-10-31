import { useEffect, useState } from 'react'
import type { ExportOptions } from '@shared/ipc'
import { useUi } from '../store'

type Phase = { kind: 'setup' } | { kind: 'running'; pct: number } | { kind: 'done'; path: string } | { kind: 'error'; msg: string }

export function ExportDialog({ onClose }: { onClose: () => void }) {
  // export renders the accepted timeline, so its format and fps are the defaults (not a pending draft's)
  const project = useUi((s) => s.session?.real ?? s.project)!
  const draftActive = useUi((s) => s.session?.draftActive ?? false)
  const [o, setO] = useState<ExportOptions>({ aspect: project.settings.aspect, resolution: 1080, fps: project.settings.fps, quality: 'standard', outPath: '' })
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })

  useEffect(() => window.pedit.onExportProgress((pct) => setPhase((p) => (p.kind === 'running' ? { kind: 'running', pct } : p))), [])

  const start = async (): Promise<void> => {
    let outPath = o.outPath
    if (!outPath) {
      const picked = await window.pedit.pickExportPath(`${project.name}.mp4`)
      if (!picked) return
      outPath = picked
      setO((x) => ({ ...x, outPath }))
    }
    setPhase({ kind: 'running', pct: 0 })
    const r = await window.pedit.exportVideo({ ...o, outPath })
    setPhase(r.ok ? { kind: 'done', path: outPath } : { kind: 'error', msg: r.error })
  }

  const sel = 'rounded bg-neutral-800 px-1.5 py-1 text-neutral-100'
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60" onClick={() => phase.kind !== 'running' && onClose()}>
      <div data-testid="export-dialog" className="w-96 rounded-lg bg-neutral-900 p-4 text-xs text-neutral-300 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold text-neutral-100">Export video</div>
        {phase.kind === 'setup' && (
          <>
            <div className="grid grid-cols-[90px_1fr] items-center gap-2">
              <span>Format</span>
              <select className={sel} value={o.aspect} onChange={(e) => setO({ ...o, aspect: e.target.value as ExportOptions['aspect'] })}>
                <option value="16:9">16:9 (YouTube)</option><option value="9:16">9:16 (Reels / Shorts)</option><option value="1:1">1:1 (Square)</option>
              </select>
              <span>Resolution</span>
              <select className={sel} value={o.resolution} onChange={(e) => setO({ ...o, resolution: Number(e.target.value) as 1080 | 2160 })}>
                <option value={1080}>1080p</option><option value={2160}>4K</option>
              </select>
              <span>Frame rate</span>
              <select className={sel} value={String(o.fps)} onChange={(e) => setO({ ...o, fps: e.target.value === 'source' ? 'source' : (Number(e.target.value) as 30 | 60) })}>
                <option value="30">30 fps</option><option value="60">60 fps</option><option value="source">Match source (up to 120)</option>
              </select>
              <span>Quality</span>
              <select className={sel} value={o.quality} onChange={(e) => setO({ ...o, quality: e.target.value as ExportOptions['quality'] })}>
                <option value="standard">Standard</option><option value="high">High (bigger file)</option>
              </select>
              <span>Save to</span>
              <button className="btn truncate text-left" title={o.outPath} onClick={async () => { const p = await window.pedit.pickExportPath(`${project.name}.mp4`); if (p) setO({ ...o, outPath: p }) }}>
                {o.outPath ? o.outPath.split(/[\\/]/).pop() : 'Choose…'}
              </button>
            </div>
            {draftActive && <div className="mt-3 rounded bg-violet-500/20 p-2 text-violet-200">Claude's draft is not accepted yet. Export uses your accepted timeline.</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button data-testid="export-start" className="btn-primary" onClick={() => void start()}>Export</button>
            </div>
          </>
        )}
        {phase.kind === 'running' && (
          <>
            <div className="mb-1">Exporting… {phase.pct}%</div>
            <div className="h-2 rounded bg-neutral-700"><div className="h-2 rounded bg-sky-500 transition-all" style={{ width: `${phase.pct}%` }} /></div>
            <div className="mt-4 flex justify-end"><button className="btn" onClick={() => window.pedit.cancelExport()}>Cancel</button></div>
          </>
        )}
        {phase.kind === 'done' && (
          <>
            <div data-testid="export-done" className="mb-3 text-emerald-300">Done: {phase.path.split(/[\\/]/).pop()}</div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => window.pedit.revealFile(phase.path)}>Open folder</button>
              <button className="btn-primary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
        {phase.kind === 'error' && (
          <>
            <div className="mb-3 text-red-300">{phase.msg}</div>
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setPhase({ kind: 'setup' })}>Back</button><button className="btn" onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  )
}

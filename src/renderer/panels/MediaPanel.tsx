import { useMemo, useState, type DragEvent } from 'react'
import type { MediaItem } from '@shared/model'
import { mediaUrl } from '@shared/mediaUrl'
import { edit, fmtDur, useUi } from '../store'
import { getPlayer } from '../preview/instance'

const STAGE_LABEL = { thumb: 'thumbnail', filmstrip: 'filmstrip', waveform: 'waveform', proxy: 'preview copy' } as const

function badge(m: MediaItem): string {
  if (m.kind === 'audio') return 'audio'
  if (m.kind === 'image') return 'photo'
  const res = Math.min(m.width, m.height) >= 2160 ? '4K' : Math.min(m.width, m.height) >= 1080 ? '1080p' : `${Math.min(m.width, m.height)}p`
  return `${res} ${Math.round(m.fps)}${m.colorTransfer !== 'sdr' ? ' HDR' : ''}`
}

function Tile({ m }: { m: MediaItem }) {
  const selected = useUi((s) => s.selectedMediaId === m.id)
  const progress = useUi((s) => s.progress[m.id])
  const select = useUi((s) => s.selectMedia)
  const working = m.status === 'processing' || m.status === 'probing'
  return (
    <div
      data-testid="media-tile" data-status={m.status} data-selected={selected ? 'true' : 'false'} data-media-id={m.id}
      draggable onDragStart={(e) => e.dataTransfer.setData('application/x-pedit-media', m.id)}
      onClick={() => select(m.id)} onDoubleClick={() => useUi.getState().previewClip(m.id)}
      className={`group relative cursor-pointer overflow-hidden rounded-md bg-neutral-800 ${selected ? 'ring-2 ring-sky-400' : 'hover:ring-1 hover:ring-neutral-500'}`}
      title={m.path}
    >
      <div className="relative aspect-video bg-neutral-900">
        {m.thumbPath ? <img src={mediaUrl(m.thumbPath)} className="h-full w-full object-cover" draggable={false} />
          : <div className="flex h-full items-center justify-center text-2xl text-neutral-600">{m.kind === 'audio' ? '♪' : '▶'}</div>}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px]">{badge(m)}</span>
        {m.kind !== 'image' && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px]">{fmtDur(m.durationMs)}</span>}
        {m.status === 'offline' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/75 text-[11px] text-red-300">
            Offline
            <button className="btn" onClick={(e) => { e.stopPropagation(); void window.pedit.relinkMedia(m.id) }}>Locate…</button>
          </div>
        )}
        {m.status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/75 p-1 text-center text-[10px] text-red-300" title={m.error}>
            Couldn't prepare preview
            <button className="btn" onClick={(e) => { e.stopPropagation(); void window.pedit.relinkMedia(m.id) }}>Locate / retry…</button>
          </div>
        )}
      </div>
      <div className="truncate px-1.5 py-1 text-[11px]">{m.name}</div>
      {working && (
        <div data-testid="media-progress" className="px-1.5 pb-1.5">
          <div className="mb-0.5 text-[9px] text-neutral-400">{!progress ? 'queued' : progress.pct === 100 && progress.stage !== 'proxy' ? 'waiting for preview copy…' : `${STAGE_LABEL[progress.stage]} ${progress.pct}%`}</div>
          <div className="h-1 rounded bg-neutral-700"><div className="h-1 rounded bg-sky-500" style={{ width: `${progress?.stage === 'proxy' ? progress.pct : 5}%` }} /></div>
        </div>
      )}
    </div>
  )
}

export function MediaPanel() {
  const media = useUi((s) => s.project?.media ?? [])
  const [tab, setTab] = useState<'media' | 'audio' | 'text'>('media')
  const [over, setOver] = useState(false)
  const groups = useMemo(() => {
    const list = media.filter((m) => (tab === 'audio' ? m.kind === 'audio' : tab === 'media'))
    const by = new Map<string, MediaItem[]>()
    for (const m of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.importIndex - b.importIndex)) {
      by.set(m.folder, [...(by.get(m.folder) ?? []), m])
    }
    return [...by.entries()]
  }, [media, tab])

  const onDrop = (e: DragEvent): void => {
    e.preventDefault(); setOver(false)
    const paths = [...e.dataTransfer.files].map((f) => window.pedit.pathForFile(f)).filter(Boolean)
    if (paths.length) void window.pedit.importPaths(paths)
  }
  const pick = async (kind: 'files' | 'folder'): Promise<void> => {
    const paths = await window.pedit.pickImport(kind)
    if (paths.length) await window.pedit.importPaths(paths)
  }

  return (
    <div data-testid="media-panel" className={`panel flex min-h-0 flex-col ${over ? 'ring-2 ring-sky-500' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="flex gap-3 border-b border-neutral-700/60 px-2 pb-1.5 text-[11px] uppercase tracking-wide">
        {(['media', 'audio', 'text'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}>{t}</button>
        ))}
      </div>
      <div className="flex gap-1.5 p-2">
        <button className="btn flex-1" onClick={() => void pick('files')}>＋ Import files</button>
        <button className="btn flex-1" onClick={() => void pick('folder')}>＋ Folder</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tab === 'text' && (
          <div className="p-2">
            <button data-testid="add-text" className="btn w-full" onClick={() => {
              const t = getPlayer()?.mode === 'timeline' ? Math.round(getPlayer()!.timeMs) : 0
              void edit({ type: 'addText', text: 'Your text', startMs: t, durationMs: 2000 })
            }}>＋ Add text at playhead</button>
            <div className="mt-2 text-[10px] text-neutral-500">Adds a 2s title. Edit it in Properties.</div>
          </div>
        )}
        {tab !== 'text' && groups.length === 0 && <div className="p-6 text-center text-xs text-neutral-500">Drop clips or folders here</div>}
        {groups.map(([folder, items]) => (
          <div key={folder} className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">{folder || 'Imported'}</div>
            <div className="grid grid-cols-2 gap-2">{items.map((m) => <Tile key={m.id} m={m} />)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

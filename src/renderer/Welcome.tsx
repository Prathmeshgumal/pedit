import { useEffect, useState } from 'react'
import type { RecentProject } from '@shared/ipc'
import { newProject, openProject } from './appMenu'
import { AppMenuButton } from './panels/TopBar'
import { openMenu } from './ContextMenu'

export function Welcome() {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const load = (): void => void window.pedit.recentProjects().then(setRecent)
  useEffect(load, [])
  const create = newProject
  const open = openProject
  const forget = async (dir: string): Promise<void> => { await window.pedit.forgetRecent(dir); load() }
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-4">
      <AppMenuButton className="absolute left-2 top-2" />
      <div className="text-2xl font-semibold">pedit</div>
      <div className="text-sm text-neutral-400">Edit videos by telling Claude what you want.</div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => void create()}>New project</button>
        <button className="btn" onClick={() => void open()}>Open project</button>
      </div>
      {recent.length > 0 && (
        <div className="mt-6 w-[480px]">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Recent projects</div>
          <div className="flex flex-col gap-1">
            {recent.map((r) => (
              <button key={r.dir} data-testid="recent-project" disabled={!r.exists}
                className="flex items-baseline gap-3 rounded-md bg-neutral-800/70 px-3 py-2 text-left hover:bg-neutral-700 disabled:opacity-50"
                title={r.exists ? r.dir : `${r.dir} (not found)`}
                onClick={() => void open(r.dir)}
                onContextMenu={(e) => openMenu(e, [{ label: 'Remove from list', onClick: () => void forget(r.dir) }])}>
                <span className="text-sm text-neutral-100">{r.name}</span>
                <span className="truncate text-[11px] text-neutral-500">{r.exists ? r.dir : 'missing — right-click to remove'}</span>
                <span className="ml-auto shrink-0 text-[11px] text-neutral-500">{new Date(r.openedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

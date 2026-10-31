export function Welcome() {
  const create = async (): Promise<void> => {
    const dir = await window.pedit.pickProjectDir('new')
    if (dir) await window.pedit.newProject(dir, dir.split(/[\\/]/).pop()!.replace(/\.pedit$/, ''))
  }
  const open = async (): Promise<void> => {
    const dir = await window.pedit.pickProjectDir('open')
    if (dir) await window.pedit.openProject(dir).catch((e: Error) => alert(e.message))
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="text-2xl font-semibold">pedit</div>
      <div className="text-sm text-neutral-400">Edit videos by telling Claude what you want.</div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => void create()}>New project</button>
        <button className="btn" onClick={() => void open()}>Open project</button>
      </div>
    </div>
  )
}

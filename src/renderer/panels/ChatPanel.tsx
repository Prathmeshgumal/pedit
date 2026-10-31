export function ChatPanel() {
  return (
    <div className="panel flex min-h-0 flex-col" style={{ gridRow: '2 / 4', gridColumn: '4' }}>
      <div className="panel-title">Claude</div>
      <div className="flex-1 text-xs text-neutral-500">Chat arrives in Milestone 3.</div>
      <div className="rounded-lg border border-dashed border-violet-400/60 bg-neutral-800 p-2 text-xs text-neutral-500">Tell Claude what to do…</div>
    </div>
  )
}

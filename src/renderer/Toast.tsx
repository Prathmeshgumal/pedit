import { useUi } from './store'
export function Toast() {
  const msg = useUi((s) => s.toast)
  if (!msg) return null
  return <div data-testid="toast" className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded bg-neutral-700 px-3 py-1.5 text-xs text-white shadow-lg">{msg}</div>
}

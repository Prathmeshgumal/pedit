import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
interface ConfirmReq { message: string; detail?: string; ok: string; resolve: (v: boolean) => void }
interface PromptReq { message: string; value: string; resolve: (v: string | null) => void }

const useOverlay = create<{ menu: { x: number; y: number; items: MenuItem[] } | null; confirm: ConfirmReq | null; prompt: PromptReq | null }>(() => ({ menu: null, confirm: null, prompt: null }))

/** Open a right-click menu at the pointer. */
export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]): void {
  e.preventDefault()
  useOverlay.setState({ menu: { x: e.clientX, y: e.clientY, items } })
}

/** Ask a yes/no question in the app's own dialog. */
export function confirmDialog(message: string, opts: { detail?: string; ok?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => useOverlay.setState({ confirm: { message, detail: opts.detail, ok: opts.ok ?? 'OK', resolve } }))
}

/** Ask for a line of text (window.prompt does not exist in Electron). */
export function promptDialog(message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => useOverlay.setState({ prompt: { message, value, resolve } }))
}

/** Keeps the menu fully on screen, flipping it up/left when it would run off an edge. */
function MenuBox({ x, y, items, close }: { x: number; y: number; items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    const left = x + r.width > window.innerWidth - 4 ? Math.max(4, x - r.width) : x
    const top = y + r.height > window.innerHeight - 4 ? Math.max(4, Math.min(y - r.height, window.innerHeight - 4 - r.height)) : y
    setPos({ left, top, ready: true })
  }, [x, y, items])
  return (
    <div ref={ref} data-testid="context-menu" className="absolute max-h-[calc(100vh-8px)] min-w-[170px] overflow-y-auto rounded-md border border-neutral-700 bg-neutral-800 py-1 text-xs shadow-xl"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button key={it.label} data-testid="menu-item" disabled={it.disabled}
          className={`block w-full px-3 py-1.5 text-left hover:bg-neutral-700 disabled:opacity-40 ${it.danger ? 'text-red-300' : 'text-neutral-200'}`}
          onClick={() => { close(); it.onClick() }}>{it.label}</button>
      ))}
    </div>
  )
}

export function Overlays() {
  const { menu, confirm, prompt } = useOverlay()
  const close = (): void => useOverlay.setState({ menu: null })
  useEffect(() => {
    if (!menu) return
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [menu])
  const answer = (v: boolean): void => { confirm?.resolve(v); useOverlay.setState({ confirm: null }) }
  const reply = (v: string | null): void => { prompt?.resolve(v); useOverlay.setState({ prompt: null }) }
  return (
    <>
      {menu && (
        <div className="fixed inset-0 z-50" onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close() }}>
          <MenuBox x={menu.x} y={menu.y} items={menu.items} close={close} />
        </div>
      )}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div data-testid="confirm" className="w-[360px] rounded-lg bg-neutral-800 p-4 text-sm shadow-xl">
            <div className="text-neutral-100">{confirm.message}</div>
            {confirm.detail && <div className="mt-1 text-xs text-neutral-400">{confirm.detail}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => answer(false)}>Cancel</button>
              <button data-testid="confirm-ok" className="btn-primary" autoFocus onClick={() => answer(true)}>{confirm.ok}</button>
            </div>
          </div>
        </div>
      )}
      {prompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <form data-testid="prompt" className="w-[360px] rounded-lg bg-neutral-800 p-4 text-sm shadow-xl"
            onSubmit={(e) => { e.preventDefault(); reply((new FormData(e.currentTarget).get('v') as string).trim() || null) }}>
            <div className="mb-2 text-neutral-100">{prompt.message}</div>
            <input name="v" data-testid="prompt-input" defaultValue={prompt.value} autoFocus className="w-full rounded bg-neutral-900 px-2 py-1 text-neutral-100" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => reply(null)}>Cancel</button>
              <button data-testid="prompt-ok" className="btn-primary">OK</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

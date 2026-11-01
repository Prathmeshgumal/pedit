import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

export interface SelectOption<V extends string> { value: V; label: string; hint?: string; style?: CSSProperties; group?: string }

/**
 * The app's dropdown (replaces the native <select>, which can't be styled on Linux).
 * Opens a list under the button; arrows / Home / End move, Enter picks, Escape closes, typing a letter jumps.
 */
export function Select<V extends string>({ value, options, onChange, testid, title, className = '', size = 'md', disabled, renderValue }: {
  value: V; options: Array<SelectOption<V>>; onChange: (v: V) => void; testid?: string; title?: string; className?: string
  size?: 'sm' | 'md'; disabled?: boolean; renderValue?: (o: SelectOption<V> | undefined) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null)
  const cur = options.find((o) => o.value === value)

  const show = (): void => {
    if (disabled) return
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (i: number): void => {
    const o = options[i]
    setOpen(false)
    btn.current?.focus()
    if (o && o.value !== value) onChange(o.value)
  }

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8
    const want = Math.min(320, options.length * 28 + 8)
    const up = below < want && above > below
    const maxH = Math.min(want, up ? above : below)
    setPos({ left: Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 4), top: up ? r.top - maxH - 4 : r.bottom + 4, width: Math.max(r.width, 160), maxH })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])

  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [open, active])

  const onKey = (e: KeyboardEvent): void => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    const n = options.length
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active) }
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase()
      const i = options.findIndex((o, j) => j > active && o.label.toLowerCase().startsWith(k))
      const j = i >= 0 ? i : options.findIndex((o) => o.label.toLowerCase().startsWith(k))
      if (j >= 0) setActive(j)
    }
  }

  const h = size === 'sm' ? 'h-6 text-[11px]' : 'h-7 text-[12px]'
  return (
    <>
      <button ref={btn} type="button" data-testid={testid} data-value={value} title={title} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        className={`sel ${h} ${className}`} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
        <span className="min-w-0 flex-1 truncate text-left" style={cur?.style}>{renderValue ? renderValue(cur) : cur?.label ?? '—'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3.5l3 3 3-3" /></svg>
      </button>
      {open && pos && (
        <div ref={list} role="listbox" data-testid={testid ? `${testid}-list` : undefined} className="sel-list" onKeyDown={onKey}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: pos.maxH }}>
          {options.map((o, i) => (
            <div key={o.value}>
              {o.group && o.group !== options[i - 1]?.group && <div className="sel-group">{o.group}</div>}
              <div role="option" aria-selected={o.value === value} data-i={i} data-value={o.value} data-testid="select-option"
                className={`sel-opt ${i === active ? 'is-active' : ''} ${o.value === value ? 'is-current' : ''}`}
                onPointerEnter={() => setActive(i)} onClick={() => pick(i)}>
                <span className="truncate" style={o.style}>{o.label}</span>
                {o.hint && <span className="ml-auto shrink-0 pl-3 text-[10px] text-neutral-500">{o.hint}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

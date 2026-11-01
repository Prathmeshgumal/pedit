import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CLAUDE_EFFORTS, type Settings } from '@shared/ipc'
import { Range } from '../ui/Range'

type Effort = Settings['claudeEffort']

export const EFFORT_LABEL: Record<Effort, string> = { default: 'Auto', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
const EFFORT_HINT: Record<Effort, string> = {
  default: 'Claude Code picks how hard to think.',
  low: 'Quick answers and simple edits.',
  medium: 'A balance of speed and care.',
  high: 'Thinks more before editing.',
  xhigh: 'Thinks a lot: slower, more careful edits.',
  max: 'Thinks as long as it needs. Slowest, and uses the most of your limit.'
}

/** Three bars that fill up with the effort level (0 = Auto shows an outline). */
function EffortIcon({ level }: { level: number }) {
  const filled = level === 0 ? 0 : Math.ceil((level / (CLAUDE_EFFORTS.length - 1)) * 3)
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.5" height={3 + i * 3} rx="0.8"
          fill={i < filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="0.9" />
      ))}
    </svg>
  )
}

/**
 * The Effort button in the composer. Clicking it opens a small popover with a stepped slider,
 * like Claude Code Desktop; the choice saves at once and applies from the next message.
 * Click outside or press Escape to close.
 */
export function EffortPicker({ value, onChange }: { value: Effort; onChange: (e: Effort) => void }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const slider = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)
  const i = CLAUDE_EFFORTS.indexOf(value)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    setPos({ right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 6 })
  }, [open])

  const shown = open && !!pos
  useEffect(() => {
    if (!shown) return
    slider.current?.focus()
    const close = (e: PointerEvent): void => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [shown])
  useEffect(() => { if (!open) setPos(null) }, [open])

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus() }
  }

  return (
    <>
      <button ref={btn} type="button" data-testid="claude-effort-button" aria-haspopup="dialog" aria-expanded={open}
        title="Effort: how hard Claude thinks (from your next message)"
        className={`chat-tool-btn gap-1.5 px-2 ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <EffortIcon level={i} />
        <span data-testid="claude-effort-label">{EFFORT_LABEL[value]}</span>
      </button>
      {open && pos && (
        <div ref={pop} role="dialog" aria-label="Effort" data-testid="claude-effort-popover" onKeyDown={onKey}
          className="effort-pop" style={{ right: pos.right, bottom: pos.bottom }}>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-neutral-100">Effort</span>
            <span className="text-[12px] text-neutral-300">{EFFORT_LABEL[value]}</span>
          </div>
          <Range ref={slider} data-testid="claude-effort" data-value={value} aria-label="Effort" aria-valuetext={EFFORT_LABEL[value]}
            className="effort mt-2 w-full" min={0} max={CLAUDE_EFFORTS.length - 1} step={1} value={i}
            onChange={(e) => onChange(CLAUDE_EFFORTS[Number(e.target.value)])} />
          <div className="mt-0.5 flex justify-between text-[10px] text-neutral-500"><span>Faster</span><span>More thorough</span></div>
          <p className="mt-2 text-[11px] leading-snug text-neutral-400">{EFFORT_HINT[value]}</p>
          <p className="mt-1 text-[10.5px] leading-snug text-neutral-500">Applies from your next message.</p>
        </div>
      )}
    </>
  )
}

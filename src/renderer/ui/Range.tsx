import type { ComponentPropsWithRef } from 'react'

/**
 * A styled range input. The filled part runs from the minimum, or from 0 when the range is two-sided
 * (e.g. contrast −100…100), so you can see at a glance how far a value is from neutral.
 */
export function Range({ value, min, max, className = '', style, ...rest }: Omit<ComponentPropsWithRef<'input'>, 'type' | 'value' | 'min' | 'max'> & { value: number; min: number; max: number }) {
  const pct = (x: number): number => ((x - min) / (max - min || 1)) * 100
  const from = min < 0 && max > 0 ? pct(0) : 0
  const at = pct(value)
  return (
    <input type="range" value={value} min={min} max={max} className={`range ${className}`} {...rest}
      style={{ ...style, ['--a' as string]: `${Math.min(from, at)}%`, ['--b' as string]: `${Math.max(from, at)}%` }} />
  )
}

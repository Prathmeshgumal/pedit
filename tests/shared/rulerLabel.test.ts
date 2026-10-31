import { describe, it, expect } from 'vitest'
import { rulerLabel } from '../../src/renderer/timeline/draw'

describe('rulerLabel', () => {
  it('pads seconds to two digits and shows tenths only when needed', () => {
    expect(rulerLabel(0)).toBe('0:00')
    expect(rulerLabel(250)).toBe('0:00.3')
    expect(rulerLabel(1500)).toBe('0:01.5')
    expect(rulerLabel(65000)).toBe('1:05')
  })
})

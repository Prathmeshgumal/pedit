import { describe, it, expect } from 'vitest'
import { fmtTimecode } from '@shared/time'

describe('fmtTimecode', () => {
  it('prints HH:MM:SS:FF at the project frame rate', () => {
    expect(fmtTimecode(3500, 30)).toBe('00:00:03:15')
    expect(fmtTimecode(0, 30)).toBe('00:00:00:00')
    expect(fmtTimecode(70_000, 25)).toBe('00:01:10:00')
    expect(fmtTimecode(3_723_040, 25)).toBe('01:02:03:01')
  })
  it('never prints a frame number equal to the rate', () => {
    expect(fmtTimecode(999.9, 30)).toBe('00:00:00:29')
  })
})

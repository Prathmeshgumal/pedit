import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaItem } from '@shared/model'
import { extractFrame, contactSheet } from '../../src/main/media/frames'
import { ffprobePath } from '../../src/main/media/ffmpeg'
import { probe } from '../../src/main/media/probe'
import { f } from './fixtures'

const media = async (rel: string): Promise<MediaItem> => ({ ...(await probe(f(rel))), id: 'm_1', folder: '', importIndex: 0, status: 'ready' })
const size = (p: string): { w: number; h: number } => {
  const [w, h] = execFileSync(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p]).toString().trim().split(',').map(Number)
  return { w, h }
}

describe('frames', () => {
  it('extracts an upright still from a rotated phone clip', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pedit-fr-')), 'f.jpg')
    await extractFrame(await media('day2/portrait_rot90.mp4'), 1000, out)
    const s = size(out)
    expect(s.h).toBeGreaterThan(s.w)
    expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(1920)
  })
  it('extracts a still from an HDR clip', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pedit-fr-')), 'h.jpg')
    await extractFrame(await media('day1/hevc_4k120_hlg.mov'), 500, out, 640)
    expect(size(out).w).toBe(640)
  })
  it('makes a 12-frame contact sheet with ascending times', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pedit-fr-')), 'sheet.jpg')
    const r = await contactSheet(await media('day1/h264_1080p30.mp4'), 12, out)
    expect(r.path).toBe(out)
    expect(existsSync(out)).toBe(true)
    expect(r.times).toHaveLength(12)
    for (let i = 1; i < 12; i++) expect(r.times[i]).toBeGreaterThan(r.times[i - 1])
    expect(r.times[11]).toBeLessThan(5000)
    expect(size(out).w).toBe(4 * 480)
  })
})

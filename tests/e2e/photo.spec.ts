import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { call, pedit, waitReady, mediaIds } from './util'

const FIX = resolve('tests/fixtures/media')
const FFMPEG = resolve('resources/ffmpeg/linux-x64/ffmpeg')

/** Average colour of a small box at (fx, fy) as fractions of the preview canvas. */
const canvasRgb = (win: Page, fx: number, fy: number): Promise<number[]> =>
  win.evaluate(([x, y]) => {
    const c = document.querySelector('[data-testid=preview-canvas]') as HTMLCanvasElement
    const o = document.createElement('canvas'); o.width = 8; o.height = 8
    const g = o.getContext('2d')!
    g.drawImage(c, c.width * x - 4, c.height * y - 4, 8, 8, 0, 0, 8, 8)
    const d = g.getImageData(0, 0, 8, 8).data
    const s = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2] }
    return s.map((v) => Math.round(v / 64))
  }, [fx, fy] as const)

test('photos import, sit on the timeline for 5s, show upright in preview and export', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'PH.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'photos'), join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 4)
  await expect(win.locator('[data-testid=media-tile]:has-text("rotated_exif6.jpg")')).toContainText('photo')
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'setFormat', aspect: '9:16' })
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['rotated_exif6.jpg'] })
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'], inMs: 0, outMs: 1000 })
  const st = await pedit<{ real: { video: Array<{ inMs: number; outMs: number }> } }>(win, 'getState')
  expect(st.real.video[0].outMs - st.real.video[0].inMs).toBe(5000)

  // the photo is upright: its red strip (left side of the stored pixels, rotated by EXIF) is at the top
  await call(win, 'seek', 2500)
  await expect.poll(async () => (await canvasRgb(win, 0.5, 0.08))[0], { timeout: 10000 }).toBeGreaterThan(180)
  const bottom = await canvasRgb(win, 0.5, 0.9)
  expect(bottom[2]).toBeGreaterThan(150) // blue below

  // playing across the photo into the video keeps going
  await call(win, 'seek', 4500)
  await call(win, 'play')
  await win.waitForTimeout(1200)
  await call(win, 'pause')
  expect(await call(win, 'getTime')).toBeGreaterThan(5000)

  const out = join(mkdtempSync(join(tmpdir(), 'pedit-out-')), 'p.mp4')
  expect(await pedit(win, 'exportVideo', { aspect: '9:16', resolution: 1080, fps: 30, quality: 'standard', outPath: out })).toEqual({ ok: true })
  const px = execFileSync(FFMPEG, ['-v', 'error', '-ss', '2', '-i', out, '-frames:v', '1', '-vf', 'crop=8:8:536:150', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  expect(px[0]).toBeGreaterThan(180) // red at the top in the export too
  await app.close()
})

test('rotating and mirroring a clip shows in the preview the same way as in export', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'RT.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'photos', 'landscape.jpg')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'setFormat', aspect: '9:16' })
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['landscape.jpg'] })
  const id = (await pedit<{ view: { video: Array<{ id: string }> } }>(win, 'getState')).view.video[0].id
  await call(win, 'seek', 1000)
  // unrotated in 9:16 the red left quarter is cropped away
  await expect.poll(async () => (await canvasRgb(win, 0.5, 0.08))[2], { timeout: 10000 }).toBeGreaterThan(150)
  await pedit(win, 'edit', { type: 'setTransform', id, transform: { rotate: 90 } })
  await call(win, 'seek', 1000)
  await expect.poll(async () => (await canvasRgb(win, 0.5, 0.08))[0], { timeout: 10000 }).toBeGreaterThan(180)
  // flipped vertically the red side goes to the bottom
  await pedit(win, 'edit', { type: 'setTransform', id, transform: { flipV: true } })
  await call(win, 'seek', 1000)
  await expect.poll(async () => (await canvasRgb(win, 0.5, 0.92))[0], { timeout: 10000 }).toBeGreaterThan(180)
  await app.close()
})

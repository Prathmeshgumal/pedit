import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { call, pedit, waitReady, mediaIds } from './util'

const FIX = resolve('tests/fixtures/media')

/** Average colourfulness (max-min of RGB) of the preview, and the brightness of its corner vs its centre. */
const stats = (win: Page): Promise<{ chroma: number; corner: number; centre: number }> => win.evaluate(() => {
  const c = document.querySelector('[data-testid=preview-canvas]') as HTMLCanvasElement
  const o = new OffscreenCanvas(c.width, c.height); const x = o.getContext('2d')!; x.drawImage(c, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let chroma = 0, n = 0
  for (let i = 0; i < d.length; i += 4 * 97) { chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n++ }
  const lum = (x0: number, y0: number, w: number, h: number): number => {
    let s = 0
    for (let y = y0; y < y0 + h; y++) for (let xx = x0; xx < x0 + w; xx++) { const i = (y * c.width + xx) * 4; s += (d[i] + d[i + 1] + d[i + 2]) / 3 }
    return s / (w * h)
  }
  return { chroma: chroma / n, corner: lum(0, 0, 16, 16), centre: lum(c.width / 2 - 8, c.height / 2 - 8, 16, 16) }
})

test('a filter from the Filters tab changes the preview; strength and vignette in Properties', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'FL.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'] })
  await expect(win.locator('[data-testid=preview-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 })
  await call(win, 'seek', 1000)
  await win.waitForTimeout(300)
  const before = await stats(win)
  expect(before.chroma).toBeGreaterThan(30) // colour bars

  await win.getByRole('button', { name: 'filters', exact: true }).click()
  await expect(win.locator('[data-testid="filter-Black & white"] img')).toBeVisible({ timeout: 10000 }) // thumbnail rendered
  await win.locator('[data-testid="filter-Black & white"]').click()
  await expect.poll(async () => (await stats(win)).chroma, { timeout: 5000 }).toBeLessThan(4)

  // half strength: some colour comes back
  const clip = (await pedit<{ view: { video: Array<{ id: string }> } }>(win, 'getState')).view.video[0].id
  await pedit(win, 'edit', { type: 'setLook', ids: [clip], filter: { name: 'Black & white', strength: 0.5, adjust: { saturation: -100, contrast: 10 } } })
  await expect.poll(async () => (await stats(win)).chroma, { timeout: 5000 }).toBeGreaterThan(before.chroma * 0.35)

  // vignette from the Properties sliders darkens the corners
  await pedit(win, 'edit', { type: 'setLook', ids: [clip], filter: null })
  const plain = await stats(win)
  await pedit(win, 'edit', { type: 'setLook', ids: [clip], adjust: { vignette: 100 } })
  await expect.poll(async () => (await stats(win)).corner, { timeout: 5000 }).toBeLessThan(plain.corner * 0.3 + 2)
  expect(Math.abs((await stats(win)).centre - plain.centre)).toBeLessThan(6)
  await app.close()
})

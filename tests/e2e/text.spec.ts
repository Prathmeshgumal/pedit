import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { call, pedit, waitReady, mediaIds } from './util'

const FIX = resolve('tests/fixtures/media')
type Box = { x0: number; y0: number; x1: number; y1: number }

const bbox = (win: import('@playwright/test').Page, w: number, h: number, position: string): Promise<Box> =>
  win.evaluate(async ([w, h, position]) => {
    const T = (window as unknown as { __peditText: { bbox(i: unknown, w: number, h: number): Promise<Box> } }).__peditText
    return T.bbox({ id: 't', startMs: 0, durationMs: 1000, text: 'Tokyo',
      style: { font: 'Inter', bold: true, sizePct: 8, color: '#ffffff', position, background: null } }, w, h)
  }, [w, h, position] as const)

test('text scales with resolution, anchors to position, and shows in the preview', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'TX.pedit') })
  const win = await app.firstWindow()
  await win.waitForFunction(() => '__peditText' in window)

  const a = await bbox(win, 1920, 1080, 'center')
  const b = await bbox(win, 3840, 2160, 'center')
  const ratio = (b.x1 - b.x0) / (a.x1 - a.x0)
  expect(ratio).toBeGreaterThan(1.96); expect(ratio).toBeLessThan(2.04)
  const hr = (b.y1 - b.y0) / (a.y1 - a.y0)
  expect(hr).toBeGreaterThan(1.96); expect(hr).toBeLessThan(2.04)

  const bot = await bbox(win, 1920, 1080, 'bottom')
  const fromBottom = (1080 - bot.y1) / 1080
  expect(fromBottom).toBeGreaterThanOrEqual(0.08); expect(fromBottom).toBeLessThanOrEqual(0.12)

  // in the app: a text item over a dark clip shows bright pixels where the text is
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'] })
  await pedit(win, 'edit', { type: 'addText', text: 'HELLO', startMs: 1000, durationMs: 2000, style: { color: '#ff00ff', sizePct: 15 } })
  await expect(win.locator('[data-testid=preview-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 })
  const magenta = async (): Promise<number> => win.evaluate(() => {
    const c = document.querySelector('[data-testid=preview-canvas]') as HTMLCanvasElement
    const o = document.createElement('canvas'); o.width = c.width; o.height = c.height
    const g = o.getContext('2d')!; g.drawImage(c, 0, 0)
    const d = g.getImageData(0, 0, o.width, o.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) n++
    return n
  })
  await call(win, 'seek', 500)
  await win.waitForTimeout(300)
  const before = await magenta()
  await call(win, 'seek', 1500)
  await expect.poll(magenta, { timeout: 5000 }).toBeGreaterThan(before + 200)
  await app.close()
})

test('main can ask the renderer for text PNGs (used by export)', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'TP.pedit') })
  const win = await app.firstWindow()
  await win.waitForFunction(() => '__peditText' in window)
  const dir = mkdtempSync(join(tmpdir(), 'pedit-png-'))
  const out = await app.evaluate(async (_e, dir) => {
    const m = (globalThis as unknown as { __peditMain: { renderTextPngs(i: unknown[], w: number, h: number, d: string): Promise<Record<string, string>> } }).__peditMain
    return m.renderTextPngs([{ id: 't_1', startMs: 0, durationMs: 1000, text: 'Tokyo', style: { font: 'Inter', bold: true, sizePct: 8, color: '#ffffff', position: 'center', background: null } }], 1080, 1920, dir)
  }, dir)
  const { readFileSync } = await import('node:fs')
  const png = readFileSync(out['t_1'])
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(1080) // IHDR width
  expect(png.readUInt32BE(20)).toBe(1920)
  await app.close()
})

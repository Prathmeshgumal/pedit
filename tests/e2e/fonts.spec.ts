import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { call, pedit, waitReady, mediaIds, choose } from './util'

const FIX = resolve('tests/fixtures/media')
type Box = { x0: number; y0: number; x1: number; y1: number }

const bbox = (win: Page, style: Record<string, unknown>): Promise<Box> =>
  win.evaluate(async (style) => {
    const T = (window as unknown as { __peditText: { bbox(i: unknown, w: number, h: number): Promise<Box> } }).__peditText
    return T.bbox({ id: 't', startMs: 0, durationMs: 1000, text: 'Tokyo Tokyo',
      style: { font: 'Inter', bold: true, sizePct: 8, color: '#ffffff', position: 'center', background: null, ...style } }, 1920, 1080)
  }, style)

/** Pixels the text layers add to the preview: drawn with and without them, counting the ones that change a lot. */
const textPixels = (win: Page): Promise<number> => win.evaluate(() => {
  type P = { draw(): void; hideText: boolean }
  const p = (window as unknown as { __peditPlayer: P }).__peditPlayer
  const c = document.querySelector('[data-testid=preview-canvas]') as HTMLCanvasElement
  const grab = (): Uint8ClampedArray => { const o = new OffscreenCanvas(c.width, c.height); const x = o.getContext('2d')!; x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height).data }
  p.draw(); const a = grab()
  p.hideText = true; p.draw(); const b = grab()
  p.hideText = false; p.draw()
  let n = 0
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 200) n++
  return n
})

test('bundled fonts draw differently, caps and spacing change the text, Hindi falls back to Devanagari', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'F.pedit') })
  const win = await app.firstWindow()
  await win.waitForFunction(() => '__peditText' in window)
  const inter = await bbox(win, {})
  const interRegular = await bbox(win, { bold: false })
  const bebas = await bbox(win, { font: 'Bebas Neue', bold: false })
  const lobster = await bbox(win, { font: 'Lobster', bold: false })
  console.log({ inter, interRegular, bebas, lobster })
  // each face has its own shape: Bebas Neue (all caps, condensed) and Lobster differ clearly from Inter
  const w = (b: Box): number => b.x1 - b.x0, h = (b: Box): number => b.y1 - b.y0
  expect(Math.abs(w(bebas) / w(interRegular) - 1) + Math.abs(h(bebas) / h(interRegular) - 1)).toBeGreaterThan(0.1)
  expect(Math.abs(w(lobster) / w(interRegular) - 1) + Math.abs(h(lobster) / h(interRegular) - 1)).toBeGreaterThan(0.1)
  const spaced = await bbox(win, { letterSpacing: 0.3 })
  expect(spaced.x1 - spaced.x0).toBeGreaterThan((inter.x1 - inter.x0) * 1.3)
  const caps = await bbox(win, { uppercase: true })
  expect(caps.x1 - caps.x0).toBeGreaterThan(inter.x1 - inter.x0)
  // a font Claude never installed falls back instead of failing
  const missing = await bbox(win, { font: 'No Such Font' })
  expect(missing.x1 - missing.x0).toBeGreaterThan(100)
  const hindi = await win.evaluate(async () => {
    const T = (window as unknown as { __peditText: { bbox(i: unknown, w: number, h: number): Promise<Box> } }).__peditText
    return T.bbox({ id: 't', startMs: 0, durationMs: 1000, text: 'नमस्ते', style: { font: 'Bebas Neue', bold: false, sizePct: 8, color: '#ffffff', position: 'center', background: null } }, 1920, 1080)
  })
  expect(hindi.x1 - hindi.x0).toBeGreaterThan(100)
  await app.close()
})

test('a text style card adds styled text; properties change font and animation; the preview animates it', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'FS.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'] })
  await expect(win.locator('[data-testid=preview-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 })

  await win.getByRole('button', { name: 'text', exact: true }).click()
  await win.locator('[data-testid="text-style-Headline"]').click()
  await expect.poll(async () => ((await pedit<{ view: { text: Array<{ style: { font: string } }> } }>(win, 'getState')).view.text[0]?.style.font)).toBe('Bebas Neue')
  const st = await pedit<{ view: { text: Array<{ id: string }> } }>(win, 'getState')
  await call(win, 'seek', 0)
  await expect(win.locator('[data-testid=prop-font]')).toHaveAttribute('data-value', 'Bebas Neue')
  await choose(win, 'prop-font', 'Lobster')
  await choose(win, 'prop-anim-in', 'pop')
  await expect.poll(async () => ((await pedit<{ view: { text: Array<{ style: Record<string, unknown> }> } }>(win, 'getState')).view.text[0].style)).toMatchObject({ font: 'Lobster', animIn: 'pop' })

  // the preview: a text with a 1s pop-in is faint and small early on, full later
  await pedit(win, 'edit', { type: 'updateText', id: st.view.text[0].id, startMs: 0, durationMs: 4000, style: { color: '#ff00ff', animIn: 'pop', animOut: 'none', animMs: 1000, outline: null, shadow: null, sizePct: 14 } })
  await call(win, 'seek', 1500)
  await expect.poll(() => textPixels(win), { timeout: 5000 }).toBeGreaterThan(2000)
  const full = await textPixels(win)
  await call(win, 'seek', 150)
  const early = await textPixels(win)
  console.log('text pixels', { early, full })
  expect(early).toBeLessThan(full * 0.2)
  await app.close()
})

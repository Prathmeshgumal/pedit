import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { pedit, waitReady, call } from './util'

const FIX = resolve('tests/fixtures/media')
type It = { id: string; track: string; left: number; right: number; cy: number; startMs: number; endMs: number }
const items = (win: Page): Promise<It[]> => win.evaluate(() => (window as unknown as { __peditTimeline: { items(): It[] } }).__peditTimeline.items())
const videoState = async (win: Page): Promise<Array<{ id: string; startMs: number; inMs: number; outMs: number }>> =>
  (await pedit<{ view: { video: Array<{ id: string; startMs: number; inMs: number; outMs: number }> } }>(win, 'getState')).view.video

/** HTML5 drag from a media tile onto a point on the timeline canvas. */
async function dragTile(win: Page, tileIndex: number, x: number, y: number): Promise<void> {
  const dt = await win.evaluateHandle(() => new DataTransfer())
  const tile = win.locator('[data-testid=media-tile]').nth(tileIndex)
  await tile.dispatchEvent('dragstart', { dataTransfer: dt })
  const canvas = win.locator('[data-testid=timeline-canvas]')
  const box = (await canvas.boundingBox())!
  const pos = { clientX: x, clientY: y, dataTransfer: dt }
  await canvas.dispatchEvent('dragover', pos)
  await canvas.dispatchEvent('drop', pos)
  void box
}

test('drag clips in, trim with the edge, split with S, undo with Ctrl+Z', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'TL.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4'), join(FIX, 'day2', 'portrait_rot90.mp4')])
  await waitReady(win, 2)
  const videoY = await win.evaluate(() => (window as unknown as { __peditTimeline: { trackY(t: string): number } }).__peditTimeline.trackY('video'))
  const left = await win.evaluate(() => (window as unknown as { __peditTimeline: { left(): number } }).__peditTimeline.left())

  await dragTile(win, 0, left + 5, videoY)
  await expect.poll(async () => (await videoState(win)).length).toBe(1)
  await win.waitForTimeout(200)
  const first = (await items(win)).find((i) => i.track === 'video')!
  await dragTile(win, 1, first.right + 20, videoY)
  await expect.poll(async () => (await videoState(win)).length).toBe(2)
  await win.waitForTimeout(200)

  const before = await videoState(win)
  const vis = (await items(win)).filter((i) => i.track === 'video').sort((a, b) => a.left - b.left)
  const edge = vis[0]
  expect(edge.right - edge.left).toBeGreaterThan(120)
  await win.mouse.move(edge.right - 1, edge.cy)
  await win.mouse.down()
  await win.mouse.move(edge.right - 50, edge.cy, { steps: 5 })
  await win.mouse.move(edge.right - 101, edge.cy, { steps: 5 })
  await win.mouse.up()
  await expect.poll(async () => (await videoState(win))[0].outMs).toBeLessThan(before[0].outMs)
  const after = await videoState(win)
  expect(after[1].startMs).toBeLessThan(before[1].startMs) // ripple: the second clip moved left
  expect(after[1].startMs).toBe(after[0].outMs - after[0].inMs)

  // split at the middle of the first clip
  await call(win, 'seek', Math.round((after[0].outMs - after[0].inMs) / 2))
  await win.locator('[data-testid=timeline-canvas]').click({ position: { x: 2, y: 2 }, trial: true })
  await win.keyboard.press('s')
  await expect.poll(async () => (await videoState(win)).length).toBe(3)

  await win.keyboard.press('Control+z')
  await expect.poll(async () => (await videoState(win)).length).toBe(2)
  await expect(win.locator('[data-testid=undo]')).toBeEnabled()
  await app.close()
})

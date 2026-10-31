import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { pedit, waitReady, call } from './util'

const FIX = resolve('tests/fixtures/media')
type It = { id: string; track: string; row: string; left: number; right: number; cy: number; startMs: number; endMs: number }
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

test('text moves along the timeline when dragged', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'TX.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const st0 = await pedit<{ real: { media: Array<{ id: string }> } }>(win, 'getState')
  await pedit(win, 'edit', { type: 'addClip', mediaId: st0.real.media[0].id })
  await win.locator('text=text').first().click()
  await win.locator('[data-testid=add-text]').click()
  await expect.poll(async () => (await items(win)).filter((i) => i.track === 'text').length).toBe(1)
  await win.waitForTimeout(200)
  const t = (await items(win)).find((i) => i.track === 'text')!
  const mid = (t.left + t.right) / 2
  await win.mouse.move(mid, t.cy)
  await win.mouse.down()
  await win.mouse.move(mid + 40, t.cy, { steps: 4 })
  await win.mouse.move(mid + 80, t.cy, { steps: 4 })
  await win.mouse.up()
  const text = async (): Promise<{ startMs: number; style: { position: string; x?: number; y?: number } }> =>
    (await pedit<{ view: { text: Array<{ startMs: number; style: { position: string; x?: number; y?: number } }> } }>(win, 'getState')).view.text[0]
  const pxPerMs = (t.right - t.left) / (t.endMs - t.startMs)
  await expect.poll(async () => (await text()).startMs).toBeGreaterThan(t.startMs + 70 / pxPerMs)
  await app.close()
})

test('audio can sit on several lanes: drop on the + AUDIO row, drag between rows', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'AL.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'music', 'track_02.mp3')])
  await waitReady(win, 1)
  const tl = <T>(fn: string, ...a: unknown[]): Promise<T> => win.evaluate(([f, x]) => (window as unknown as { __peditTimeline: Record<string, (...y: unknown[]) => unknown> }).__peditTimeline[f as string](...(x as unknown[])), [fn, a] as const) as Promise<T>
  const left = await tl<number>('left')
  const audio = async (): Promise<Array<{ lane?: number; startMs: number; inMs: number; outMs: number }>> =>
    (await pedit<{ view: { audio: Array<{ lane?: number; startMs: number; inMs: number; outMs: number }> } }>(win, 'getState')).view.audio

  await dragTile(win, 0, left + 5, await tl<number>('rowY', 'audio:0'))
  await expect.poll(async () => (await audio()).length).toBe(1)
  await pedit(win, 'edit', { type: 'trimItem', id: (await pedit<{ view: { audio: Array<{ id: string }> } }>(win, 'getState')).view.audio[0].id, outMs: 3000 })
  await expect.poll(() => tl<string[]>('rows')).toEqual(['text', 'video', 'audio:0', 'audio:new'])
  await dragTile(win, 0, left + 5, await tl<number>('rowY', 'audio:new'))
  await expect.poll(async () => (await audio()).map((a) => a.lane ?? 0).sort()).toEqual([0, 1])
  await expect.poll(() => tl<string[]>('rows')).toEqual(['text', 'video', 'audio:0', 'audio:1', 'audio:new'])

  // trim the lane-1 sound short, then drag it down... up onto the music row, after the 3s music piece
  const l1 = (await items(win)).find((i) => i.row === 'audio:1')!
  await pedit(win, 'edit', { type: 'trimItem', id: l1.id, outMs: 1000 })
  await win.waitForTimeout(200)
  const it = (await items(win)).find((i) => i.row === 'audio:1')!
  const music = (await items(win)).find((i) => i.row === 'audio:0')!
  await win.mouse.move(it.left + 10, it.cy)
  await win.mouse.down()
  await win.mouse.move(music.right + 40, it.cy, { steps: 4 })
  await win.mouse.move(music.right + 40, music.cy, { steps: 4 })
  await win.mouse.up()
  await expect.poll(async () => (await audio()).every((a) => (a.lane ?? 0) === 0)).toBe(true)
  await app.close()
})

async function oneClip(name: string): Promise<{ app: Awaited<ReturnType<typeof launch>>; win: Page; clip: () => Promise<{ id: string; startMs: number; inMs: number; outMs: number; transform?: { rotate: number } }> }> {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), `${name}.pedit`) })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const st0 = await pedit<{ real: { media: Array<{ id: string }> } }>(win, 'getState')
  await pedit(win, 'edit', { type: 'addClip', mediaId: st0.real.media[0].id })
  await expect.poll(async () => (await items(win)).filter((i) => i.track === 'video').length).toBe(1)
  return { app, win, clip: async () => (await pedit<{ view: { video: Array<{ id: string; startMs: number; inMs: number; outMs: number; transform?: { rotate: number } }> } }>(win, 'getState')).view.video[0] }
}

async function selectClipAt(win: Page, ms: number): Promise<void> {
  await win.evaluate((t) => (window as unknown as { __peditPlayer: { seek(ms: number): Promise<void> } }).__peditPlayer.seek(t), ms)
  const v = (await items(win)).find((i) => i.track === 'video')!
  // click the clip body away from the playhead line and the edges
  await win.mouse.click(v.left + (v.right - v.left) * 0.8, v.cy)
}

test('Q deletes the part of the clip left of the playhead, W the part to the right', async () => {
  const { app, win, clip } = await oneClip('QW')
  await selectClipAt(win, 2000)
  await win.keyboard.press('q')
  await expect.poll(async () => { const c = await clip(); return c.outMs - c.inMs }).toBe(3000)
  await win.keyboard.press('Control+z')
  await expect.poll(async () => { const c = await clip(); return c.outMs - c.inMs }).toBe(5000)
  await selectClipAt(win, 2000)
  await win.keyboard.press('w')
  await expect.poll(async () => { const c = await clip(); return c.outMs - c.inMs }).toBe(2000)
  await app.close()
})

test('toolbar Rotate turns the selected clip a quarter turn', async () => {
  const { app, win, clip } = await oneClip('ROT')
  await expect(win.locator('[data-testid=tool-rotate]')).toBeDisabled()
  await selectClipAt(win, 1000)
  await win.locator('[data-testid=tool-rotate]').click()
  await expect.poll(async () => (await clip()).transform?.rotate).toBe(90)
  await app.close()
})

test('with snapping off a text item can land one frame away from an edge', async () => {
  const { app, win } = await oneClip('SNAP')
  await pedit(win, 'edit', { type: 'addText', text: 'hi', startMs: 2000, durationMs: 1000 })
  await expect.poll(async () => (await items(win)).filter((i) => i.track === 'text').length).toBe(1)
  const text = async (): Promise<number> => (await pedit<{ view: { text: Array<{ startMs: number }> } }>(win, 'getState')).view.text[0].startMs
  const dragTextTo = async (ms: number): Promise<void> => {
    const t = (await items(win)).find((i) => i.track === 'text')!
    const pxPerMs = (t.right - t.left) / (t.endMs - t.startMs)
    const mid = (t.left + t.right) / 2
    await win.mouse.move(mid, t.cy); await win.mouse.down()
    await win.mouse.move(mid + (ms - t.startMs) * pxPerMs / 2, t.cy, { steps: 4 })
    await win.mouse.move(mid + (ms - t.startMs) * pxPerMs, t.cy, { steps: 4 })
    await win.mouse.up()
  }
  // the playhead sits at 0; move it away so only the clip edge at 0 attracts
  await win.evaluate(() => (window as unknown as { __peditPlayer: { seek(ms: number): Promise<void> } }).__peditPlayer.seek(4500))
  await dragTextTo(1000 / 30)
  await expect.poll(text).toBe(0) // snapped onto the clip's start
  await pedit(win, 'edit', { type: 'moveItem', id: (await items(win)).find((i) => i.track === 'text')!.id, toMs: 2000 })
  await expect.poll(text).toBe(2000)
  await win.keyboard.press('n')
  await expect(win.locator('[data-testid=tool-snap]')).toHaveAttribute('data-on', 'false')
  await dragTextTo(1000 / 30)
  await expect.poll(text).toBeGreaterThan(0)
  expect(await text()).toBeLessThan(100)
  await app.close()
})

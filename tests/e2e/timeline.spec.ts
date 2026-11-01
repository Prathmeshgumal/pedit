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

async function rightClickClip(win: Page, label: string): Promise<void> {
  const v = (await items(win)).find((i) => i.track === 'video')!
  await win.mouse.click(v.left + (v.right - v.left) * 0.8, v.cy, { button: 'right' })
  await win.locator(`[data-testid=menu-item]:has-text("${label}")`).click()
}

test('right-click Extract audio puts the sound on its own row and it still plays', async () => {
  const { app, win, clip } = await oneClip('XA')
  await rightClickClip(win, 'Extract audio')
  await expect.poll(async () => (await clip() as unknown as { volume: number }).volume).toBe(0)
  const audioRows = async (): Promise<string[]> => (await items(win)).filter((i) => i.track === 'audio').map((i) => i.row)
  await expect.poll(async () => (await audioRows()).length).toBe(1)
  await win.evaluate(() => (window as unknown as { __peditPlayer: { seek(ms: number): Promise<void>; play(): void } }).__peditPlayer.seek(0))
  await win.evaluate(() => (window as unknown as { __peditPlayer: { play(): void } }).__peditPlayer.play())
  await expect.poll(() => win.evaluate(() => (window as unknown as { __peditPlayer: { stats(): { audioScheduled: number } } }).__peditPlayer.stats().audioScheduled)).toBeGreaterThan(0)
  await app.close()
})

test('Freeze frame at 2s splits the clip around a 3s photo from the "Freeze frames" folder', async () => {
  const { app, win } = await oneClip('FZ')
  await win.evaluate(() => (window as unknown as { __peditPlayer: { seek(ms: number): Promise<void> } }).__peditPlayer.seek(2000))
  await rightClickClip(win, 'Freeze frame')
  type St = { view: { video: Array<{ mediaId: string; startMs: number; inMs: number; outMs: number }>; media: Array<{ id: string; kind: string; folder: string }> } }
  await expect.poll(async () => (await pedit<St>(win, 'getState')).view.video.length).toBe(3)
  const st = await pedit<St>(win, 'getState')
  const mid = st.view.video[1]
  const m = st.view.media.find((x) => x.id === mid.mediaId)!
  expect([m.kind, m.folder, mid.startMs, mid.outMs - mid.inMs]).toEqual(['image', 'Freeze frames', 2000, 3000])
  await app.close()
})

test('Crop dialog with the 1:1 preset crops a portrait phone clip to a square', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'CR.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day2', 'portrait_rot90.mp4')])
  await waitReady(win, 1)
  const st0 = await pedit<{ real: { media: Array<{ id: string }> } }>(win, 'getState')
  await pedit(win, 'edit', { type: 'addClip', mediaId: st0.real.media[0].id })
  await expect.poll(async () => (await items(win)).filter((i) => i.track === 'video').length).toBe(1)
  await rightClickClip(win, 'Crop')
  // click the preset straight away, before the frame has finished loading
  await win.locator('[data-testid=crop-ratio]:has-text("1:1")').click()
  await expect(win.locator('[data-testid=crop-dialog] img')).toBeVisible()
  const nat = await win.locator('[data-testid=crop-dialog] img').evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }))
  expect(nat.h).toBeGreaterThan(nat.w)
  await win.locator('[data-testid=crop-apply]').click()
  type C = { transform?: { crop: { w: number; h: number } } }
  const clip = async (): Promise<C> => (await pedit<{ view: { video: C[] } }>(win, 'getState')).view.video[0]
  await expect.poll(async () => { const c = (await clip()).transform?.crop; return c ? c.w * c.h : 1 }).toBeLessThan(1)
  const c = (await clip()).transform!.crop
  expect(Math.abs(c.w * nat.w - c.h * nat.h)).toBeLessThan(4)
  await app.close()
})

test('F toggles full-screen preview', async () => {
  const { app, win } = await oneClip('FS')
  await win.keyboard.press('f')
  await expect.poll(() => win.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null)).toBe('preview-panel')
  await win.keyboard.press('f')
  await expect.poll(() => win.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await app.close()
})

test('blade tool cuts a clip where you click; the scissors on the playhead cut there', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'BL.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const st0 = await pedit<{ real: { media: Array<{ id: string }> } }>(win, 'getState')
  await pedit(win, 'edit', { type: 'addClip', mediaId: st0.real.media[0].id })
  await win.waitForTimeout(300)
  const clip = (await items(win)).find((i) => i.track === 'video')!
  const fps = 30

  // B turns the blade on; clicking at 40% of the clip cuts there (on a frame)
  await win.locator('[data-testid=timeline-canvas]').hover({ position: { x: 2, y: 2 } })
  await win.keyboard.press('b')
  await expect(win.locator('[data-testid=tool-blade]')).toHaveAttribute('data-on', 'true')
  const x = clip.left + (clip.right - clip.left) * 0.4
  await win.mouse.move(x, clip.cy)
  await win.mouse.click(x, clip.cy)
  await expect.poll(async () => (await videoState(win)).length).toBe(2)
  const cutMs = (await videoState(win))[0].outMs
  expect(Math.abs(cutMs - 2000)).toBeLessThan(100)
  expect(Math.abs((cutMs * fps) / 1000 - Math.round((cutMs * fps) / 1000))).toBeLessThan(0.02)

  // Escape goes back to select; the playhead's scissors cut the clip under it
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-testid=tool-select]')).toHaveAttribute('data-on', 'true')
  await call(win, 'seek', 3500)
  await win.waitForTimeout(300)
  const r = await win.locator('[data-testid=timeline-canvas]').boundingBox()
  const ph = await win.evaluate(() => (window as unknown as { __peditTimeline: { left(): number } }).__peditTimeline.left())
  const after = (await items(win)).filter((i) => i.track === 'video').sort((a, b) => a.left - b.left)
  const pxPerMs = (after[1].right - after[1].left) / (5000 - cutMs)
  await win.mouse.click(ph + 3500 * pxPerMs, r!.y + 14)
  await expect.poll(async () => (await videoState(win)).length).toBe(3)
  expect((await videoState(win))[1].outMs).toBe(3500)
  await app.close()
})

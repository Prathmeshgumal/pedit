import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { call, pedit, waitReady, mediaIds, choose } from './util'

const FIX = resolve('tests/fixtures/media')
const FFMPEG = resolve('resources/ffmpeg/linux-x64/ffmpeg')
const GW = 48, GH = 27

/** The preview shrunk to a GW×GH RGB grid. */
const previewGrid = (win: Page): Promise<number[]> => win.evaluate(([w, h]) => {
  const c = document.querySelector('[data-testid=preview-canvas]') as HTMLCanvasElement
  const o = new OffscreenCanvas(w, h); const x = o.getContext('2d')!
  x.imageSmoothingQuality = 'high'
  x.drawImage(c, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h).data
  const out: number[] = []
  for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2])
  return out
}, [GW, GH])

/** Frame n of a video shrunk to the same grid. */
const exportGrid = (file: string, n: number): number[] =>
  [...execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),scale=${GW}:${GH}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]

const diff = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length

const CUTS = ['wiperight', 'slideleft', 'circleopen', 'fadeblack', 'zoomin', 'smoothup', 'wipeup', 'slidedown'] as const

test('transitions in the preview match the exported video', async () => {
  test.setTimeout(180000)
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'TR.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'photos', 'landscape.jpg'), join(FIX, 'photos', 'square.png')])
  await waitReady(win, 2)
  const ids = await mediaIds(win)
  for (let i = 0; i <= CUTS.length; i++) await pedit(win, 'edit', { type: 'addClip', mediaId: ids[i % 2 ? 'square.png' : 'landscape.jpg'] })
  const clips = (await pedit<{ view: { video: Array<{ id: string }> } }>(win, 'getState')).view.video.map((v) => v.id)
  await pedit(win, 'edit', { type: 'batch', commands: CUTS.map((t, i) => ({ type: 'setTransition', ids: [clips[i + 1]], transition: { type: t, durationMs: 2000 } })) })
  const video = (await pedit<{ view: { video: Array<{ startMs: number }> } }>(win, 'getState')).view.video
  expect(video.map((v) => v.startMs)).toEqual(CUTS.map((_, i) => 3000 * i).concat(3000 * CUTS.length)) // each cut overlaps by 2 s
  await expect(win.locator('[data-testid=preview-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 })

  const out = join(mkdtempSync(join(tmpdir(), 'pedit-out-')), 'tr.mp4')
  expect(await pedit(win, 'exportVideo', { aspect: '16:9', resolution: 1080, fps: 30, quality: 'standard', outPath: out })).toEqual({ ok: true })

  const grid = async (ms: number): Promise<number[]> => {
    await call(win, 'seek', ms)
    await win.waitForTimeout(150)
    return previewGrid(win)
  }
  const plainA = await grid(1000), plainB = await grid(4500 + 1000)
  const apart = diff(plainA, plainB)
  expect(apart).toBeGreaterThan(30) // the two photos look different, so a match means something
  for (const [i, t] of CUTS.entries()) {
    const start = 3000 * (i + 1)
    for (const ms of [start + 1000, start + 1500]) {
      const d = diff(await grid(ms), exportGrid(out, Math.round((ms * 30) / 1000)))
      console.log(t, ms, d.toFixed(1))
      expect(d, `${t} at ${ms} ms`).toBeLessThan(8)
    }
  }
  await app.close()
})

test('pick a transition from the button at a cut; change it and the J/L cut in Properties', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'TRUI.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'] })
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'], inMs: 1000 })
  const view = (): Promise<{ video: Array<{ id: string; startMs: number; transition?: { type: string; durationMs: number }; audioCutMs?: number }> }> =>
    pedit<{ view: never }>(win, 'getState').then((s) => s.view)
  const cuts = (): Promise<Array<{ id: string; has: boolean; x: number; y: number }>> => win.evaluate(() => (window as unknown as { __peditTimeline: { cuts(): never } }).__peditTimeline.cuts())
  await expect.poll(async () => (await cuts()).length).toBe(1)
  const [cut] = await cuts()
  expect(cut.has).toBe(false)
  await win.mouse.click(cut.x, cut.y)
  await win.locator('[data-testid=menu-item]', { hasText: 'Slide left' }).click()
  await expect.poll(async () => (await view()).video[1].transition).toEqual({ type: 'slideleft', durationMs: 500 })
  expect((await view()).video[1].startMs).toBe(4500) // overlaps the first clip by 0.5 s
  expect((await cuts())[0].has).toBe(true)

  // Properties of the second clip
  const now = (await cuts())[0]
  await win.mouse.click(now.x + 20, now.y) // inside the overlap: the incoming clip is on top
  await expect(win.locator('[data-testid=prop-transition]')).toHaveAttribute('data-value', 'slideleft')
  await choose(win, 'prop-transition', 'circleopen')
  await expect.poll(async () => (await view()).video[1].transition?.type).toBe('circleopen')
  const sound = win.locator('[data-testid=prop-audio-cut]')
  await sound.focus()
  for (let i = 0; i < 5; i++) await win.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await view()).video[1].audioCutMs).toBe(-500)
  await expect(win.locator('[data-testid=properties]')).toContainText("J-cut: this clip's sound starts 0.5s before its picture")
  // and back to a plain cut from the menu
  await win.mouse.click((await cuts())[0].x, (await cuts())[0].y)
  await win.locator('[data-testid=menu-item]', { hasText: 'No transition' }).click()
  await expect.poll(async () => (await view()).video[1].transition).toBeUndefined()
  await app.close()
})

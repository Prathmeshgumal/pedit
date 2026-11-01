import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { pedit, waitReady, mediaIds } from './util'

const FIX = resolve('tests/fixtures/media')

test('export from the app renders text through the renderer and writes an mp4', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'EX.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'], inMs: 0, outMs: 2000 })
  await pedit(win, 'edit', { type: 'addText', text: 'Tokyo', startMs: 0, durationMs: 1000 })

  await win.locator('[data-testid=export]').click()
  await expect(win.locator('[data-testid=export-dialog]')).toBeVisible()
  await win.keyboard.press('Escape')

  const out = join(mkdtempSync(join(tmpdir(), 'pedit-out-')), 'a.mp4')
  const r = await pedit<{ ok: boolean; error?: string }>(win, 'exportVideo', { aspect: '16:9', resolution: 1080, fps: 30, quality: 'standard', outPath: out })
  expect(r).toEqual({ ok: true })
  expect(existsSync(out)).toBe(true)
  await app.close()
})

test('quitting during an export stops ffmpeg and leaves no half-written file', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'EQ.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  for (let i = 0; i < 12; i++) await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'] })
  const out = join(mkdtempSync(join(tmpdir(), 'pedit-out-')), 'q.mp4')
  void pedit(win, 'exportVideo', { aspect: '16:9', resolution: 2160, fps: 60, quality: 'high', outPath: out }).catch(() => {})
  await expect.poll(() => existsSync(`${out}.part`), { timeout: 30000 }).toBe(true)
  await app.close()
  await expect.poll(() => existsSync(`${out}.part`), { timeout: 10000 }).toBe(false)
  expect(existsSync(out)).toBe(false)
  const running = (): string => { try { return execFileSync('pgrep', ['-f', '--', out]).toString().trim() } catch { return '' } }
  expect(running()).toBe('')
})

test("look_at_timeline renders Claude's draft with its text, from the preview files", async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'LT.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'] })
  await pedit(win, 'edit', { type: 'addText', text: 'HELLO', startMs: 0, durationMs: 2000, style: { color: '#ff8000', sizePct: 14 } })
  const b64 = await app.evaluate(async (_e, t) => (globalThis as unknown as { __peditMain: { lookAtTimeline(t: number[]): Promise<string> } }).__peditMain.lookAtTimeline(t), [500, 1000, 3000, 4000])
  const file = join(mkdtempSync(join(tmpdir(), 'pedit-lt-')), 's.jpg')
  writeFileSync(file, Buffer.from(b64, 'base64'))
  const [w, h] = execFileSync(resolve('resources/ffmpeg/linux-x64/ffprobe'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number)
  expect([w, h]).toEqual([4 * 480 + 12, 270])
  // orange text pixels in the first two cells only
  const px = execFileSync(resolve('resources/ffmpeg/linux-x64/ffmpeg'), ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 })
  const magenta = (cell: number): number => {
    let n = 0
    for (let y = 0; y < h; y++) for (let x = cell * 484; x < cell * 484 + 480; x++) { const i = (y * w + x) * 3; if (px[i] > 220 && px[i + 1] > 100 && px[i + 1] < 160 && px[i + 2] < 70) n++ }
    return n
  }
  const counts = [0, 1, 2, 3].map(magenta)
  console.log('orange', counts)
  expect(counts[0]).toBeGreaterThan(Math.max(500, counts[2] * 5))
  expect(counts[1]).toBeGreaterThan(Math.max(500, counts[3] * 5))
  await app.close()
})

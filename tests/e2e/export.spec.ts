import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
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

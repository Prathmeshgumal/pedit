import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { pedit, waitReady } from './util'

const FIX = resolve('tests/fixtures/media')
const FFPROBE = resolve('resources/ffmpeg/linux-x64/ffprobe')

test('demo: ask for a reel, accept the draft, export a vertical video with music', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'D.pedit'), PEDIT_CLAUDE_BIN: resolve('tests/fake-claude/fake-claude.mjs'), FAKE_CLAUDE_MODE: 'demo' })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1'), join(FIX, 'music')])
  await waitReady(win, 4)

  await win.locator('[data-testid=chat-input]').fill('Make a 9s vertical reel of day 1 in order, title Tokyo, with the music')
  await win.locator('[data-testid=chat-send]').click()
  await expect(win.locator('[data-testid=draft-bar]')).toContainText('format 9:16', { timeout: 60000 })
  await expect(win.locator('[data-testid=chat-input]')).toBeEnabled({ timeout: 60000 })
  await expect(win.locator('[data-testid=chat-msg-assistant]').last()).toContainText('vertical')
  // the draft is 9:16, but export uses the accepted timeline, so the dialog starts from its format
  await win.locator('[data-testid=export]').click()
  await expect(win.locator('[data-testid=export-aspect]')).toHaveAttribute('data-value', '16:9')
  await win.locator('[data-testid=export-dialog]').evaluate((el) => (el.parentElement as HTMLElement).click())
  await win.locator('[data-testid=draft-accept]').click()
  const st = await pedit<{ real: { video: unknown[]; text: unknown[]; audio: unknown[]; settings: { aspect: string } } }>(win, 'getState')
  expect([st.real.video.length, st.real.text.length, st.real.audio.length, st.real.settings.aspect]).toEqual([3, 1, 1, '9:16'])

  const out = join(mkdtempSync(join(tmpdir(), 'pedit-out-')), 'reel.mp4')
  const r = await pedit<{ ok: boolean; error?: string }>(win, 'exportVideo', { aspect: '9:16', resolution: 1080, fps: 30, quality: 'standard', outPath: out })
  expect(r).toEqual({ ok: true })
  expect(existsSync(out)).toBe(true)
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]).toString()) as { streams: Array<{ codec_type: string; width?: number; height?: number }>; format: { duration: string } }
  const v = j.streams.find((s) => s.codec_type === 'video')!
  expect([v.width, v.height]).toEqual([1080, 1920])
  expect(Math.abs(Number(j.format.duration) - 9)).toBeLessThanOrEqual(0.1)
  expect(j.streams.some((s) => s.codec_type === 'audio')).toBe(true)
  await app.close()
})

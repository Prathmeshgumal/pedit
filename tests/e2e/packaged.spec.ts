import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { headlessArgs } from './helpers'

const BIN = resolve('dist/linux-unpacked/pedit')

test('packaged app launches with bundled ffmpeg and a working encoder', async () => {
  test.skip(!existsSync(BIN) && !process.env.PEDIT_REQUIRE_PACKAGED, 'run `npm run dist` first')
  const userData = mkdtempSync(join(tmpdir(), 'pedit-ud-'))
  const app = await electron.launch({ executablePath: BIN, args: [`--user-data-dir=${userData}`, ...headlessArgs()], env: { ...process.env, PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-pk-')), 'P.pedit') } as Record<string, string> })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid=app-root]')).toBeVisible()
  const d = await win.evaluate(() => (window as unknown as { pedit: { diagnostics(): Promise<{ ffmpeg: string; encoder: string; claude: string | null }> } }).pedit.diagnostics())
  expect(d.ffmpeg).toContain('resources/ffmpeg/linux-x64/ffmpeg')
  expect(d.ffmpeg).not.toContain('node_modules')
  expect(d.encoder.length).toBeGreaterThan(0)
  console.log('diagnostics', d)
  await app.close()
})

test('the AppImage launches and imports a clip', async () => {
  const appImage = resolve('dist/pedit-0.1.0.AppImage')
  test.skip(!existsSync(appImage) && !process.env.PEDIT_REQUIRE_PACKAGED, 'run `npm run dist` first')
  const userData = mkdtempSync(join(tmpdir(), 'pedit-ud-'))
  const app = await electron.launch({ executablePath: appImage, args: [`--user-data-dir=${userData}`, ...headlessArgs()], env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-ai-')), 'A.pedit') } as Record<string, string> })
  const win = await app.firstWindow()
  await win.evaluate((p) => (window as unknown as { pedit: { importPaths(p: string[]): Promise<void> } }).pedit.importPaths(p), [resolve('tests/fixtures/media/day1/h264_1080p30.mp4')])
  await expect(win.locator('[data-testid=media-tile][data-status=ready]')).toHaveCount(1, { timeout: 60000 })
  expect(await win.evaluate(() => (window as unknown as { pedit: { claudeStatus(): Promise<{ ok: boolean }> } }).pedit.claudeStatus())).toMatchObject({ ok: true })
  await app.close()
})

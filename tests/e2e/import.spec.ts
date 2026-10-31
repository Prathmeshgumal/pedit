import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'

const FIX = resolve('tests/fixtures/media')

test('imports a folder instantly, builds proxies in background, stays responsive, survives restart', async () => {
  const projectDir = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'Trip.pedit')
  let app = await launch({ PEDIT_PROJECT_DIR: projectDir })
  let win = await app.firstWindow()
  await expect(win.locator('[data-testid=media-panel]')).toBeVisible()

  const t0 = Date.now()
  await win.evaluate((p) => (window as unknown as { pedit: { importPaths(p: string[]): Promise<void> } }).pedit.importPaths([p]), FIX)
  await expect(win.locator('[data-testid=media-tile]')).toHaveCount(6, { timeout: 2000 })
  expect(Date.now() - t0).toBeLessThan(2500)

  // responsive while proxies build
  const tile = win.locator('[data-testid=media-tile]').first()
  const c0 = Date.now()
  await tile.click()
  await expect(tile).toHaveAttribute('data-selected', 'true', { timeout: 200 })
  expect(Date.now() - c0).toBeLessThan(400)

  await expect(win.locator('[data-testid=media-progress]')).toHaveCount(0, { timeout: 180000 })
  await expect(win.locator('[data-testid=media-tile][data-status=ready]')).toHaveCount(6)
  await app.close()

  app = await launch({ PEDIT_PROJECT_DIR: projectDir })
  win = await app.firstWindow()
  await expect(win.locator('[data-testid=media-tile]')).toHaveCount(6, { timeout: 5000 })
  await expect(win.locator('[data-testid=media-tile][data-status=ready]')).toHaveCount(6, { timeout: 5000 })
  await app.close()
})

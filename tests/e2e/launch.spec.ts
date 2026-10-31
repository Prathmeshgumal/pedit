import { test, expect } from '@playwright/test'
import { launch } from './helpers'

test('app launches with pedit window', async () => {
  const app = await launch()
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid=app-root]')).toBeVisible()
  expect(await win.title()).toBe('pedit')
  await app.close()
})

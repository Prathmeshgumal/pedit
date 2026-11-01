import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { pedit, waitReady, mediaIds } from './util'

const FIX = resolve('tests/fixtures/media')

test('close a project, see it on the start screen, reopen it from the recent list', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'Trip.pedit')
  const app = await launch({ PEDIT_PROJECT_DIR: dir })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid=project-name]')).toHaveText('Trip')
  await pedit(win, 'renameProject', 'Kedarnath')
  await expect(win.locator('[data-testid=project-name]')).toHaveText('Kedarnath')
  await pedit(win, 'closeProject')
  const recent = win.locator('[data-testid=recent-project]')
  await expect(recent).toHaveCount(1)
  await expect(recent).toContainText('Kedarnath')
  await recent.click()
  await expect(win.locator('[data-testid=project-name]')).toHaveText('Kedarnath')
  await app.close()
})

test('removing media used on the timeline asks first, removes its clips, and undo brings them back', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'RM.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4'), join(FIX, 'photos', 'square.png')])
  await waitReady(win, 2)
  const ids = await mediaIds(win)
  await pedit(win, 'edit', { type: 'addClip', mediaId: ids['h264_1080p30.mp4'] })
  const state = (): Promise<{ real: { media: unknown[]; video: unknown[] } }> => pedit(win, 'getState')

  // unused media goes without a question
  await win.locator('[data-testid=media-tile]:has-text("square.png")').click({ button: 'right' })
  await win.locator('[data-testid=menu-item]:has-text("Remove")').click()
  await expect(win.locator('[data-testid=media-tile]')).toHaveCount(1)

  // used media asks
  await win.locator('[data-testid=media-tile]').first().click({ button: 'right' })
  await win.locator('[data-testid=menu-item]:has-text("Remove")').click()
  await expect(win.locator('[data-testid=confirm]')).toContainText('Used 1 time')
  await win.locator('[data-testid=confirm-ok]').click()
  await expect(win.locator('[data-testid=media-tile]')).toHaveCount(0)
  expect((await state()).real.video).toHaveLength(0)
  await win.locator('[data-testid=undo]').click()
  await expect.poll(async () => (await state()).real.video.length).toBe(1)
  await expect(win.locator('[data-testid=media-tile]')).toHaveCount(1)
  await app.close()
})

test('the window has no native menu bar; the in-app menu and its shortcuts work', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'Menu.pedit') })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid=project-name]')).toHaveText('Menu')
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull()

  await win.locator('[data-testid=app-menu]').click()
  const items = win.locator('[data-testid=menu-item]')
  for (const l of ['New project', 'Open project', 'Import media', 'Export video', 'Close project', 'Undo', 'Quit']) await expect(items.filter({ hasText: l })).toHaveCount(1)
  await expect(items.filter({ hasText: 'Export video' })).toBeDisabled() // nothing on the timeline yet
  await win.keyboard.press('Escape')

  // menu item: close the project, then the start screen also has the menu
  await win.locator('[data-testid=app-menu]').click()
  await items.filter({ hasText: 'Close project' }).click()
  await expect(win.locator('[data-testid=recent-project]')).toHaveCount(1)
  await expect(win.locator('[data-testid=app-menu]')).toBeVisible()
  await win.locator('[data-testid=recent-project]').click()
  await expect(win.locator('[data-testid=project-name]')).toHaveText('Menu')

  // shortcut: Ctrl+W closes it too
  await win.keyboard.press('Control+w')
  await expect(win.locator('[data-testid=recent-project]')).toHaveCount(1)
  await app.close()
})

import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { headlessArgs } from './helpers'

type Box = { x: number; y: number; width: number; height: number }
const box = async (win: Page, testid: string): Promise<Box> => (await win.locator(`[data-testid=${testid}]`).boundingBox())!

/** Drags a splitter by (dx, dy) from its centre. */
async function drag(win: Page, testid: string, dx: number, dy: number): Promise<void> {
  const b = await box(win, testid)
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.move(x + dx / 2, y + dy / 2)
  await win.mouse.move(x + dx, y + dy)
  await win.mouse.up()
}

const launchWith = (userData: string, project: string) =>
  electron.launch({ args: ['.', `--user-data-dir=${userData}`, ...headlessArgs()], env: { ...process.env, PEDIT_PROJECT_DIR: project } as Record<string, string> })

test('drag the borders to resize panels, hide and show the Claude chat; the layout is remembered', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'pedit-ud-'))
  const project = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'L.pedit')
  let app = await launchWith(userData, project)
  let win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960))
  await expect(win.locator('[data-testid=workspace]')).toBeVisible()
  await expect(win.locator('[data-testid=chat]')).toBeVisible()

  // media panel: wider by the drag
  const media0 = await box(win, 'media-panel')
  await drag(win, 'splitter-media', 120, 0)
  await expect.poll(async () => Math.round((await box(win, 'media-panel')).width - media0.width)).toBeGreaterThanOrEqual(115)

  // chat: dragging its border left makes it wider; the preview gives up the room
  const chat0 = await box(win, 'chat'), preview0 = await box(win, 'preview-panel')
  await drag(win, 'splitter-chat', -80, 0)
  await expect.poll(async () => Math.round((await box(win, 'chat')).width - chat0.width)).toBeGreaterThanOrEqual(75)
  expect((await box(win, 'preview-panel')).width).toBeLessThan(preview0.width - 70)

  // timeline: dragging its border up makes it taller
  const tl0 = await box(win, 'timeline')
  await drag(win, 'splitter-timeline', 0, -90)
  await expect.poll(async () => Math.round((await box(win, 'timeline')).height - tl0.height)).toBeGreaterThanOrEqual(85)

  // panels stop at their minimum: the media panel can't be dragged away
  await drag(win, 'splitter-media', -2000, 0)
  await expect.poll(async () => Math.round((await box(win, 'media-panel')).width)).toBe(160)

  // keyboard: arrows move a focused border
  const props0 = await box(win, 'properties')
  await win.locator('[data-testid=splitter-props]').focus()
  await win.keyboard.press('ArrowLeft')
  await win.keyboard.press('ArrowLeft')
  await expect.poll(async () => Math.round((await box(win, 'properties')).width - props0.width)).toBe(32)

  // hide the chat: the timeline and the side panels take the space
  const tlWide0 = (await box(win, 'timeline')).width
  await win.locator('[data-testid=chat-close]').click()
  await expect(win.locator('[data-testid=chat]')).toBeHidden()
  await expect(win.locator('[data-testid=workspace]')).toHaveAttribute('data-chat-open', 'false')
  await expect(win.locator('[data-testid=chat-toggle]')).toHaveAttribute('aria-pressed', 'false')
  expect((await box(win, 'timeline')).width).toBeGreaterThan(tlWide0 + 250)
  // and bring it back from the top bar, then with Ctrl+J
  await win.locator('[data-testid=chat-toggle]').click()
  await expect(win.locator('[data-testid=chat]')).toBeVisible()
  await win.locator('[data-testid=timeline-canvas]').click({ position: { x: 5, y: 5 } })
  await win.keyboard.press('Control+j')
  await expect(win.locator('[data-testid=chat]')).toBeHidden()

  // sizes and the closed chat survive a restart
  const mediaBefore = (await box(win, 'media-panel')).width, tlBefore = (await box(win, 'timeline')).height
  await app.close()
  app = await launchWith(userData, project)
  win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960))
  await expect(win.locator('[data-testid=workspace]')).toHaveAttribute('data-chat-open', 'false')
  await expect(win.locator('[data-testid=chat]')).toBeHidden()
  await expect.poll(async () => Math.round((await box(win, 'media-panel')).width)).toBe(Math.round(mediaBefore))
  expect(Math.round((await box(win, 'timeline')).height)).toBe(Math.round(tlBefore))

  // double-clicking a border puts that panel back to its default share (11.65% of the editor's width)
  const inner = async (): Promise<number> => (await box(win, 'workspace')).width - 12
  await win.keyboard.press('Control+j')
  await win.locator('[data-testid=splitter-media]').dblclick()
  await expect.poll(async () => Math.round((await box(win, 'media-panel')).width)).toBe(Math.round(Math.max(160, 0.1165 * (await inner()))))

  // the Reset layout button puts everything back, shows the chat, and then has nothing left to do
  await win.locator('[data-testid=chat-close]').click()
  await expect(win.locator('[data-testid=layout-reset]')).toBeEnabled()
  await win.locator('[data-testid=layout-reset]').click()
  await expect(win.locator('[data-testid=chat]')).toBeVisible()
  await expect(win.locator('[data-testid=layout-reset]')).toBeDisabled()
  const w = await inner(), h = (await box(win, 'workspace')).height - 12
  await expect.poll(async () => Math.round((await box(win, 'chat')).width)).toBe(Math.round(Math.max(280, 0.1375 * w)))
  expect(Math.round((await box(win, 'properties')).width)).toBe(Math.round(Math.max(200, 0.1195 * w)))
  expect(Math.round((await box(win, 'timeline')).height)).toBe(Math.round(Math.max(120, 0.2675 * h)))
  await app.close()
})

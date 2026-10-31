import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { pedit, waitReady } from './util'

const FIX = resolve('tests/fixtures/media')
const FAKE = resolve('tests/fake-claude/fake-claude.mjs')
type St = { real: { video: unknown[]; text: unknown[] }; view: { video: unknown[]; text: unknown[] }; draftActive: boolean }
const state = (win: Page): Promise<St> => pedit<St>(win, 'getState')
const open = (dir: string, mode?: string) => launch({ PEDIT_PROJECT_DIR: dir, PEDIT_CLAUDE_BIN: FAKE, ...(mode ? { FAKE_CLAUDE_MODE: mode } : {}) })
async function say(win: Page, text: string): Promise<void> {
  await win.locator('[data-testid=chat-input]').fill(text)
  await win.locator('[data-testid=chat-send]').click()
}

test('claude edits arrive as a draft I can reject or accept, and history survives a restart', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'C.pedit')
  let app = await open(dir)
  let win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)

  await say(win, 'make a title')
  const steps = win.locator('[data-testid=chat-step]')
  await expect(steps.filter({ hasText: /✓ added (?!text)/ })).toHaveCount(1, { timeout: 20000 })
  await expect(steps.filter({ hasText: /✓ added text/ })).toHaveCount(1)
  await expect(win.locator('[data-testid=draft-bar]')).toContainText('2 added')
  await expect(win.locator('[data-testid=chat-input]')).toBeEnabled()
  let st = await state(win)
  expect(st.real.video).toHaveLength(0)
  expect(st.view.video).toHaveLength(1)

  await win.locator('[data-testid=draft-reject]').click()
  await expect.poll(async () => (await state(win)).view.video.length).toBe(0)
  await expect(win.locator('[data-testid=draft-bar]')).toHaveCount(0)

  await say(win, 'try again')
  await expect(win.locator('[data-testid=draft-bar]')).toContainText('2 added', { timeout: 20000 })
  await expect(win.locator('[data-testid=chat-input]')).toBeEnabled()
  await win.locator('[data-testid=draft-accept]').click()
  await expect.poll(async () => (await state(win)).real.video.length).toBe(1)
  st = await state(win)
  expect(st.real.text).toHaveLength(1)
  await win.locator('[data-testid=timeline-canvas]').click({ position: { x: 5, y: 5 } })
  await win.keyboard.press('Control+z')
  await expect.poll(async () => { const s = await state(win); return s.real.video.length + s.real.text.length }).toBe(0)
  await app.close()

  app = await open(dir)
  win = await app.firstWindow()
  await expect(win.locator('[data-testid=chat-msg-user]')).toHaveCount(2)
  await expect(win.locator('[data-testid=chat-step]').first()).toBeVisible()
  await app.close()
})

test('stop keeps the partial draft; login problems show a hint', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'S.pedit')
  let app = await open(dir, 'slow')
  let win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1', 'h264_1080p30.mp4')])
  await waitReady(win, 1)
  await say(win, 'slowly')
  await expect(win.locator('[data-testid=chat-input]')).toBeDisabled()
  await expect(win.locator('[data-testid=chat-step]').filter({ hasText: '✓ added' })).toHaveCount(1, { timeout: 15000 })
  // the clip is in the draft; accept/reject wait until Claude is done
  await expect(win.locator('[data-testid=draft-accept]')).toBeDisabled()
  await expect(win.locator('[data-testid=draft-reject]')).toBeDisabled()
  // stop while the fake sleeps before its next edit
  await win.locator('[data-testid=chat-stop]').click()
  await expect(win.locator('[data-testid=chat-msg-system]')).toContainText('Stopped', { timeout: 5000 })
  await expect(win.locator('[data-testid=chat-input]')).toBeEnabled()
  expect((await state(win)).draftActive).toBe(true)
  await expect(win.locator('[data-testid=draft-accept]')).toBeEnabled()
  await app.close()

  app = await open(dir, 'not_logged_in')
  win = await app.firstWindow()
  await say(win, 'hello')
  await expect(win.locator('[data-testid=chat-msg-system]').last()).toContainText('run claude once to log in', { timeout: 10000 })
  await app.close()
})

import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

test('a photo attached to the chat joins the library once and Claude can look at it', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'AT.pedit')
  const app = await open(dir, 'look')
  const win = await app.firstWindow()
  const photo = join(FIX, 'photos', 'landscape.jpg')
  const attach = async (): Promise<void> => { await win.locator('[data-testid=chat-attach-input]').setInputFiles(photo) }
  await attach()
  await expect(win.locator('[data-testid=chat-chip]')).toContainText('landscape.jpg')
  await expect(win.locator('[data-testid=media-tile]')).toHaveCount(1)
  await attach()
  await expect(win.locator('[data-testid=chat-chip]')).toHaveCount(1)
  type S = { real: { media: Array<{ name: string; folder: string }> } }
  expect((await pedit<S>(win, 'getState')).real.media.map((m) => [m.name, m.folder])).toEqual([['landscape.jpg', 'Chat']])
  await waitReady(win, 1)
  await say(win, 'what is in this photo?')
  await expect(win.locator('[data-testid=chat-msg-assistant]')).toContainText(/saw \d+ bytes/, { timeout: 20000 })
  const n = Number(/saw (\d+) bytes/.exec(await win.locator('[data-testid=chat-msg-assistant]').innerText())![1])
  expect(n).toBeGreaterThan(1000)
  await app.close()
})

test('a .md file attached in chat becomes the story Claude reads, and shows in the Story tab', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'ST.pedit')
  const app = await open(dir)
  const win = await app.firstWindow()
  await win.locator('[data-testid=chat-attach-input]').setInputFiles(resolve('tests/fixtures/story/story.md'))
  await expect(win.locator('[data-testid=chat-chip]')).toContainText('story.md')
  await win.locator('text=story').first().click()
  await expect(win.locator('[data-testid=story-text]')).toHaveValue(/temple bells/)
  await win.locator('[data-testid=story-text]').fill('# New story\nonly sunsets')
  await expect.poll(() => pedit<string>(win, 'getStory')).toBe('# New story\nonly sunsets')
  await app.close()
})

test('any file can be attached: it is kept in the project, Claude gets its path and text, and the reply is formatted', async () => {
  const base = mkdtempSync(join(tmpdir(), 'pedit-e2e-'))
  const dir = join(base, 'F.pedit')
  const srt = join(base, 'subs.srt'), cube = join(base, 'warm.cube')
  writeFileSync(srt, '1\n00:00:01,000 --> 00:00:02,000\nGood morning, Tokyo\n')
  writeFileSync(cube, 'LUT_3D_SIZE 2\n')
  const app = await open(dir, 'files')
  const win = await app.firstWindow()
  await win.locator('[data-testid=chat-attach-input]').setInputFiles([srt, cube])
  const chips = win.locator('[data-testid=chat-chip]')
  await expect(chips).toHaveCount(2)
  await expect(chips.first()).toHaveAttribute('title', 'Attached file')
  expect(readFileSync(join(dir, 'chat-files', 'warm.cube'), 'utf8')).toBe('LUT_3D_SIZE 2\n')
  // non-media files don't land in the media library
  expect((await pedit<{ real: { media: unknown[] } }>(win, 'getState')).real.media).toHaveLength(0)
  await say(win, 'use these')
  const reply = win.locator('[data-testid=chat-msg-assistant]')
  await expect(reply.locator('strong')).toHaveText('Files I got', { timeout: 20000 })
  await expect(reply.locator('li')).toHaveText(['subs.srt', 'warm.cube'])
  await expect(reply.locator('code')).toHaveText('Good morning, Tokyo')
  await app.close()
})

test('dragging files anywhere over the chat shows the drop target', async () => {
  const app = await open(join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'DD.pedit'))
  const win = await app.firstWindow()
  const list = win.locator('[data-testid=chat-list]')
  const dt = await win.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'notes.pdf', { type: 'application/pdf' })); return d })
  await list.dispatchEvent('dragenter', { dataTransfer: dt })
  await expect(win.locator('[data-testid=chat-drop]')).toBeVisible()
  await list.dispatchEvent('dragleave', { dataTransfer: dt })
  await expect(win.locator('[data-testid=chat-drop]')).toHaveCount(0)
  await app.close()
})

test('the Effort button opens a popover with the slider; it and the model dropdown save the setting', async () => {
  const app = await open(join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'EF.pedit'))
  const win = await app.firstWindow()
  const button = win.locator('[data-testid=claude-effort-button]')
  const popover = win.locator('[data-testid=claude-effort-popover]')
  const effort = win.locator('[data-testid=claude-effort]')
  await expect(win.locator('[data-testid=claude-effort-label]')).toHaveText('Auto')
  // the slider lives in the popover, not in the composer
  await expect(effort).toHaveCount(0)
  await button.click()
  await expect(popover).toBeVisible()
  await expect(effort).toHaveAttribute('data-value', 'default')
  await expect(effort).toBeFocused()
  await win.keyboard.press('ArrowRight'); await win.keyboard.press('ArrowRight')
  await expect(effort).toHaveAttribute('data-value', 'medium')
  await expect(win.locator('[data-testid=claude-effort-label]')).toHaveText('Medium')
  // Escape closes it and gives focus back to the button; a click outside closes it too
  await win.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(button).toBeFocused()
  await button.click()
  await expect(popover).toBeVisible()
  await win.locator('[data-testid=chat-list]').click()
  await expect(popover).toHaveCount(0)
  await win.locator('[data-testid=claude-model]').click()
  await win.keyboard.press('ArrowDown') // the list opens on the current choice; one down is Opus
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid=claude-model]')).toHaveAttribute('data-value', 'opus')
  expect(await pedit(win, 'getSettings')).toMatchObject({ claudeModel: 'opus', claudeEffort: 'medium' })
  await app.close()
})

import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from '../e2e/helpers'
import { pedit, waitReady } from '../e2e/util'

const FIX = resolve('tests/fixtures/media')
const PROMPT = process.env.DEMO_PROMPT ?? "Put the Tokyo clips in order, trim each to 3 seconds, add a title 'Tokyo' at the start, put track_02 under it"

test('real claude runs the demo prompt', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-real-')), 'R.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1'), join(FIX, 'day2'), join(FIX, 'music')])
  await waitReady(win, 5)
  await win.evaluate(() => {
    const w = window as unknown as { __events: unknown[]; pedit: { onChatEvent(cb: (e: unknown) => void): void } }
    w.__events = []
    w.pedit.onChatEvent((e) => w.__events.push(e))
  })
  const t0 = Date.now()
  await win.locator('[data-testid=chat-input]').fill(PROMPT)
  await win.locator('[data-testid=chat-send]').click()
  await expect(win.locator('[data-testid=chat-input]')).toBeEnabled({ timeout: 600000 })
  const wall = (Date.now() - t0) / 1000
  const events = await win.evaluate(() => (window as unknown as { __events: Array<{ kind: string; name?: string; ok?: boolean; text?: string; usage?: unknown; error?: string }> }).__events)
  const st = await pedit<{ view: unknown; diff: unknown }>(win, 'getState')
  const report = { prompt: PROMPT, wallSeconds: wall, tools: events.filter((e) => e.kind === 'tool').map((e) => e.name), errors: events.filter((e) => e.kind === 'toolResult' && !e.ok).map((e) => e.text),
    replies: events.filter((e) => e.kind === 'text').map((e) => e.text), done: events.find((e) => e.kind === 'done'), view: st.view, diff: st.diff }
  writeFileSync(process.env.DEMO_REPORT ?? join(tmpdir(), 'pedit-real-claude.json'), JSON.stringify(report, null, 2))
  await win.screenshot({ path: process.env.DEMO_SHOT ?? join(tmpdir(), 'pedit-real-claude.png') })
  await app.close()
})

import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'

const FIX = resolve('tests/fixtures/media')
type Stats = { presented: number; dropped: number; lastSeekMs: number }
interface TestPlayer { play(): void; pause(): void; seek(ms: number): Promise<void>; stats(): Stats; durationMs: number }
const player = (win: Page, fn: string, ...args: unknown[]): Promise<unknown> =>
  win.evaluate(([f, a]) => {
    const p = (window as unknown as { __peditPlayer: Record<string, (...x: unknown[]) => unknown> }).__peditPlayer
    return p[f as string](...(a as unknown[]))
  }, [fn, args] as const)

async function selectReady(win: Page, name: string): Promise<void> {
  const tile = win.locator(`[data-testid=media-tile]:has-text("${name}")`)
  await expect(tile).toHaveAttribute('data-status', 'ready', { timeout: 180000 })
  await tile.click()
  await expect(win.locator('[data-testid=preview-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 })
}

test('4K120 clip plays smoothly and scrubs fast; portrait is upright', async () => {
  const projectDir = join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'Bench.pedit')
  const app = await launch({ PEDIT_PROJECT_DIR: projectDir })
  const win = await app.firstWindow()
  await win.evaluate((p) => (window as unknown as { pedit: { importPaths(p: string[]): Promise<void> } }).pedit.importPaths(p), [join(FIX, 'bench'), join(FIX, 'day2')])

  await selectReady(win, 'long_4k120.mov')
  await player(win, 'play')
  await win.waitForTimeout(10000)
  await player(win, 'pause')
  const s = (await player(win, 'stats')) as Stats
  const ratio = s.presented / (s.presented + s.dropped)
  const fps = s.presented / 10
  console.log('playback', { ...s, ratio, fps })
  expect(ratio).toBeGreaterThanOrEqual(0.95)
  expect(fps).toBeGreaterThanOrEqual(55)

  const lat: number[] = []
  for (let i = 0; i < 20; i++) {
    await player(win, 'seek', Math.floor(Math.random() * 58000))
    lat.push(((await player(win, 'stats')) as Stats).lastSeekMs)
  }
  lat.sort((a, b) => a - b)
  const median = (lat[9] + lat[10]) / 2
  console.log('seek ms', lat)
  expect(median).toBeLessThan(100)
  appendFileSync('docs/benchmarks.md', `\n## ${new Date().toISOString()} single clip (bench/long_4k120.mov proxy)\n- playback: ${fps.toFixed(1)} fps presented, ${(ratio * 100).toFixed(1)}% presented, dropped ${s.dropped}\n- seek latency median ${median.toFixed(1)} ms, max ${lat[19].toFixed(1)} ms\n`)

  await selectReady(win, 'portrait_rot90.mp4')
  const box = await win.locator('[data-testid=preview-canvas]').boundingBox()
  expect(box!.width / box!.height).toBeLessThan(1)
  await app.close()
})

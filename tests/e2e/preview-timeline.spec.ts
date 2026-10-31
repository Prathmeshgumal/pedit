import { test, expect } from '@playwright/test'
import { mkdtempSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './helpers'
import { call, pedit, waitReady, mediaIds, centerLuma, type Stats } from './util'

const FIX = resolve('tests/fixtures/media')

test('10-minute 4K120 timeline plays smoothly, scrubs fast, cuts are never black', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'T.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'bench')])
  await waitReady(win, 1)
  const ids = await mediaIds(win)
  for (let i = 0; i < 10; i++) await pedit(win, 'edit', { type: 'addClip', mediaId: ids['long_4k120.mov'] })
  await expect(win.locator('[data-testid=preview-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 })
  expect(await call(win, 'getDuration')).toBe(600000)

  await call(win, 'seek', 58000) // play across the first cut at 60s
  await call(win, 'play')
  await win.waitForTimeout(10000)
  await call(win, 'pause')
  const s = (await call(win, 'stats')) as Stats
  const ratio = s.presented / (s.presented + s.dropped)
  const fps = s.presented / 10
  console.log('timeline playback', { ...s, ratio, fps })
  expect(ratio).toBeGreaterThanOrEqual(0.95)
  expect(fps).toBeGreaterThanOrEqual(55)

  const lat: number[] = []
  for (let i = 0; i < 20; i++) {
    await call(win, 'seek', Math.floor(Math.random() * 599000))
    lat.push(((await call(win, 'stats')) as Stats).lastSeekMs)
  }
  lat.sort((a, b) => a - b)
  const median = (lat[9] + lat[10]) / 2
  expect(median).toBeLessThan(100)

  for (const cut of [60000, 120000, 180000, 240000, 300000]) {
    await call(win, 'seek', cut + 5)
    expect(await centerLuma(win)).toBeGreaterThan(20)
  }
  appendFileSync('docs/benchmarks.md', `\n## ${new Date().toISOString()} timeline (10 × long_4k120.mov = 10 min)\n- playback across a cut: ${fps.toFixed(1)} fps, ${(ratio * 100).toFixed(1)}% presented, dropped ${s.dropped}\n- seek latency median ${median.toFixed(1)} ms, max ${lat[19].toFixed(1)} ms\n`)
  await app.close()
})

test('mixed timeline with and without audio plays to the end in real time', async () => {
  const app = await launch({ PEDIT_PROJECT_DIR: join(mkdtempSync(join(tmpdir(), 'pedit-e2e-')), 'M.pedit') })
  const win = await app.firstWindow()
  await pedit(win, 'importPaths', [join(FIX, 'day1')])
  await waitReady(win, 3)
  const ids = await mediaIds(win)
  for (const n of ['hevc_4k120_hlg.mov', "Tōkyō day 1 'final'.mov", 'h264_1080p30.mp4']) await pedit(win, 'edit', { type: 'addClip', mediaId: ids[n] })
  await expect(win.locator('[data-testid=preview-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 10000 })
  expect(await call(win, 'getDuration')).toBe(13000)
  const t0 = Date.now()
  await call(win, 'play')
  await expect.poll(() => call(win, 'isPlayingNow'), { timeout: 20000, intervals: [50] }).toBe(false)
  const wall = Date.now() - t0
  console.log('wall', wall)
  expect(Math.abs(wall - 13000)).toBeLessThan(150 + 100) // 100ms allowance for test polling round-trips
  expect(await call(win, 'getTime')).toBe(13000)
  await app.close()
})

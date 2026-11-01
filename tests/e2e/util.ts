import { expect, type Page } from '@playwright/test'

export type Stats = { presented: number; dropped: number; lastSeekMs: number }

export const call = (win: Page, fn: string, ...args: unknown[]): Promise<unknown> =>
  win.evaluate(([f, a]) => {
    const p = (window as unknown as { __peditPlayer: Record<string, (...x: unknown[]) => unknown> }).__peditPlayer
    return p[f as string](...(a as unknown[]))
  }, [fn, args] as const)

export const pedit = <T>(win: Page, fn: string, ...args: unknown[]): Promise<T> =>
  win.evaluate(([f, a]) => {
    const p = (window as unknown as { pedit: Record<string, (...x: unknown[]) => unknown> }).pedit
    return p[f as string](...(a as unknown[]))
  }, [fn, args] as const) as Promise<T>

export async function waitReady(win: Page, count: number): Promise<void> {
  await expect(win.locator('[data-testid=media-tile][data-status=ready]')).toHaveCount(count, { timeout: 240000 })
}

export async function mediaIds(win: Page): Promise<Record<string, string>> {
  const st = await pedit<{ real: { media: Array<{ id: string; name: string }> } }>(win, 'getState')
  return Object.fromEntries(st.real.media.map((m) => [m.name, m.id]))
}

/** Average luminance (0-255) of the preview canvas center region. */
export const centerLuma = (win: Page): Promise<number> =>
  win.evaluate(() => {
    const c = document.querySelector('[data-testid=preview-canvas]') as HTMLCanvasElement
    const o = document.createElement('canvas'); o.width = 64; o.height = 64
    const g = o.getContext('2d')!
    g.drawImage(c, c.width / 2 - 32, c.height / 2 - 32, 64, 64, 0, 0, 64, 64)
    const d = g.getImageData(0, 0, 64, 64).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3
    return s / (d.length / 4)
  })

/** Pick a value in one of the app's dropdowns (ui/Select). */
export async function choose(win: Page, testid: string, value: string): Promise<void> {
  await win.locator(`[data-testid=${testid}]`).click()
  await win.locator(`[data-testid=${testid}-list] [data-testid=select-option][data-value="${value}"]`).click()
}

import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function launch(env: Record<string, string> = {}): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'pedit-ud-'))
  return electron.launch({ args: ['.', `--user-data-dir=${userData}`, ...headlessArgs()], env: { ...process.env, ...env } as Record<string, string> })
}

/** PEDIT_E2E_HEADLESS=1 runs the app without opening windows on the desktop (Chromium's headless Ozone backend). */
export const headlessArgs = (): string[] => (process.env.PEDIT_E2E_HEADLESS ? ['--ozone-platform=headless', '--ozone-override-screen-size=1920,1080'] : [])

import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function launch(env: Record<string, string> = {}): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'pedit-ud-'))
  return electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, ...env } as Record<string, string> })
}

import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, DEFAULT_SETTINGS } from '../../src/main/settings'

describe('settings', () => {
  it('starts with defaults, saves changes and reads them back', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'pedit-set-')), 'settings.json')
    const a = new SettingsStore(f)
    expect(await a.get()).toEqual(DEFAULT_SETTINGS)
    expect(await a.set({ claudeModel: 'sonnet' })).toMatchObject({ claudeModel: 'sonnet', claudeEffort: 'default' })
    await a.set({ claudeEffort: 'high' })
    expect(await new SettingsStore(f).get()).toEqual({ claudeModel: 'sonnet', claudeEffort: 'high' })
  })
  it('falls back to the default for unknown or broken values', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'pedit-set-')), 'settings.json')
    writeFileSync(f, JSON.stringify({ claudeModel: 'gpt-9', claudeEffort: 'max' }))
    expect(await new SettingsStore(f).get()).toEqual({ claudeModel: 'default', claudeEffort: 'max' })
    writeFileSync(f, '{not json')
    expect(await new SettingsStore(f).get()).toEqual(DEFAULT_SETTINGS)
    expect(await new SettingsStore(f).set({ claudeModel: 'nope' as never })).toEqual(DEFAULT_SETTINGS)
  })
})

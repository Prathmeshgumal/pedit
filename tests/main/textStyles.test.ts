import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { TextStyleLibrary } from '../../src/main/library/textStyles'
import { FontLibrary } from '../../src/main/library/fonts'
import { BUILTIN_TEXT_PRESETS } from '../../src/shared/textPresets'

describe('text style library', () => {
  it('starts with the built-in looks, all using bundled fonts', async () => {
    const lib = new TextStyleLibrary(join(mkdtempSync(join(tmpdir(), 'pedit-ts-')), 'text-styles.json'))
    const all = await lib.list()
    expect(all.length).toBe(BUILTIN_TEXT_PRESETS.length)
    const fonts = new FontLibrary(resolve('resources/fonts'), mkdtempSync(join(tmpdir(), 'pedit-f-')))
    for (const p of all) if (p.style.font) expect(await fonts.find(p.style.font), p.name).not.toBeNull()
  })
  it('saves a new look, keeps it across restarts, and replaces one with the same name', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'pedit-ts-')), 'text-styles.json')
    const lib = new TextStyleLibrary(f)
    await lib.save('My caption', 'mine', { font: 'Caveat', color: '#ff0000' })
    await lib.save('my caption', 'mine v2', { font: 'Caveat', color: '#00ff00' })
    expect(existsSync(f)).toBe(true)
    const again = new TextStyleLibrary(f)
    const mine = (await again.list()).filter((p) => p.source === 'user')
    expect(mine).toEqual([{ name: 'my caption', description: 'mine v2', style: { font: 'Caveat', color: '#00ff00' }, source: 'user' }])
    expect(await again.find('MY CAPTION')).toMatchObject({ style: { color: '#00ff00' } })
    expect(await again.find('shorts pop')).toMatchObject({ source: 'builtin' })
  })
  it('a saved look may not take a built-in name', async () => {
    const lib = new TextStyleLibrary(join(mkdtempSync(join(tmpdir(), 'pedit-ts-')), 't.json'))
    await expect(lib.save('Clean', '', { color: '#000' })).rejects.toThrow(/built-in/)
  })
})

import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilterLibrary } from '../../src/main/library/filters'
import { BUILTIN_FILTERS } from '../../src/shared/filterPresets'

const lib = (): { l: FilterLibrary; dir: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'pedit-fl-'))
  return { l: new FilterLibrary(join(dir, 'filters.json'), join(dir, 'luts')), dir }
}
const INV = 'LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n'

describe('filter library', () => {
  it('starts with the built-in filters', async () => {
    const { l } = lib()
    const all = await l.list()
    expect(all.length).toBe(BUILTIN_FILTERS.length)
    expect(all.map((f) => f.name)).toContain('Cinematic')
    expect(await l.find('black & WHITE')).toMatchObject({ adjust: { saturation: -100 }, source: 'builtin' })
  })
  it('saves a new filter made of adjustments and keeps it', async () => {
    const { l, dir } = lib()
    await l.save('Tokyo blue', 'cool city', { temperature: -40, contrast: 10 })
    const again = new FilterLibrary(join(dir, 'filters.json'), join(dir, 'luts'))
    expect(await again.find('tokyo blue')).toMatchObject({ name: 'Tokyo blue', source: 'user', adjust: { temperature: -40 } })
    await expect(l.save('Warm', '', {})).rejects.toThrow(/built-in/)
  })
  it('imports a .cube LUT as a filter (copied into the library) and rejects broken files', async () => {
    const { l, dir } = lib()
    const src = join(dir, 'invert.cube'); writeFileSync(src, INV)
    const f = await l.importCube('Invert', 'test', src, { saturation: 10 })
    expect(f.lut && existsSync(f.lut)).toBe(true)
    expect(f.lut!.startsWith(join(dir, 'luts'))).toBe(true)
    expect(f.adjust).toEqual({ saturation: 10 })
    const bad = join(dir, 'bad.cube'); writeFileSync(bad, 'LUT_3D_SIZE 2\n1 1 1\n')
    await expect(l.importCube('Bad', '', bad)).rejects.toThrow(/expected 8/)
  })
})

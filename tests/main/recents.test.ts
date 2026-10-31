import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Recents } from '../../src/main/recents'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pedit-recent-'))
const project = (base: string, name: string): string => { const d = join(base, `${name}.pedit`); mkdirSync(d); writeFileSync(join(d, 'project.json'), '{}'); return d }

describe('Recents', () => {
  it('keeps the newest first, without duplicates, at most 12', async () => {
    const base = tmp()
    const r = new Recents(join(base, 'recent.json'))
    const dirs = Array.from({ length: 14 }, (_, i) => project(base, `p${i}`))
    for (const [i, d] of dirs.entries()) await r.add(d, `p${i}`)
    await r.add(dirs[3], 'p3 renamed')
    const list = await r.list()
    expect(list).toHaveLength(12)
    expect(list[0]).toMatchObject({ dir: dirs[3], name: 'p3 renamed', exists: true })
    expect(list.filter((x) => x.dir === dirs[3])).toHaveLength(1)
  })
  it('flags projects that no longer exist and can forget them', async () => {
    const base = tmp()
    const r = new Recents(join(base, 'recent.json'))
    await r.add(join(base, 'gone.pedit'), 'gone')
    expect((await r.list())[0].exists).toBe(false)
    await r.remove(join(base, 'gone.pedit'))
    expect(await r.list()).toEqual([])
  })
  it('survives a corrupt file', async () => {
    const base = tmp()
    writeFileSync(join(base, 'recent.json'), '{nope')
    expect(await new Recents(join(base, 'recent.json')).list()).toEqual([])
  })
})

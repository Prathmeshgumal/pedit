import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FontLibrary, parseGoogleCss } from '../../src/main/library/fonts'

const BUILTIN = resolve('resources/fonts')
const CSS = `@font-face {
  font-family: 'Bungee';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/bungee/v1/a.ttf) format('truetype');
}
@font-face {
  font-family: 'Bungee';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/bungee/v1/b.ttf) format('truetype');
}`

/** A fake fetch serving Google Fonts CSS for "Bungee" (400 + 700) and font bytes. */
function fakeFetch(calls: string[]): typeof fetch {
  return (async (input: string | URL) => {
    const u = String(input)
    calls.push(u)
    if (u.includes('fonts.googleapis.com')) {
      if (!u.includes('family=Bungee')) return new Response('bad family', { status: 400 })
      return new Response(CSS)
    }
    if (u.endsWith('.ttf')) return new Response(new Uint8Array([0, 1, 0, 0, u.length]))
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('font library', () => {
  it('lists the bundled fonts with files that exist', async () => {
    const lib = new FontLibrary(BUILTIN, mkdtempSync(join(tmpdir(), 'pedit-fonts-')))
    const fonts = await lib.list()
    const names = fonts.map((f) => f.family)
    for (const n of ['Inter', 'Montserrat', 'Bebas Neue', 'Noto Sans Devanagari', 'Permanent Marker']) expect(names).toContain(n)
    expect(fonts.length).toBeGreaterThanOrEqual(25)
    for (const f of fonts) {
      expect(f.source).toBe('builtin')
      expect(f.faces.length).toBeGreaterThan(0)
      for (const face of f.faces) expect(existsSync(face.path)).toBe(true)
    }
  })

  it('reads the weights and urls out of Google Fonts css', () => {
    expect(parseGoogleCss(CSS)).toEqual([
      { weight: 400, url: 'https://fonts.gstatic.com/s/bungee/v1/a.ttf' },
      { weight: 700, url: 'https://fonts.gstatic.com/s/bungee/v1/b.ttf' }
    ])
  })

  it('downloads a Google font by name into the user library and keeps it', async () => {
    const user = mkdtempSync(join(tmpdir(), 'pedit-fonts-'))
    const calls: string[] = []
    const lib = new FontLibrary(BUILTIN, user, fakeFetch(calls))
    const f = await lib.addGoogle('bungee')
    expect(f).toMatchObject({ family: 'Bungee', source: 'user' })
    expect(f.faces.map((x) => x.weight)).toEqual([400, 700])
    for (const face of f.faces) expect(existsSync(face.path)).toBe(true)
    // a fresh library (next app start) still has it
    const again = await new FontLibrary(BUILTIN, user).list()
    expect(again.find((x) => x.family === 'Bungee')?.source).toBe('user')
    // asking for a font that is already there downloads nothing
    calls.length = 0
    expect((await lib.addGoogle('Montserrat')).source).toBe('builtin')
    expect(calls).toEqual([])
  })

  it('falls back to the regular weight when a font has no bold, and explains unknown fonts', async () => {
    const user = mkdtempSync(join(tmpdir(), 'pedit-fonts-'))
    const fetchFn = (async (input: string | URL) => {
      const u = String(input)
      if (u.includes('wght@400;700')) return new Response('no such weight', { status: 400 })
      if (u.includes('family=Bungee')) return new Response(CSS.split('}\n')[0] + '}')
      if (u.includes('fonts.googleapis.com')) return new Response('bad', { status: 400 })
      return new Response(new Uint8Array([1, 2, 3]))
    }) as typeof fetch
    const lib = new FontLibrary(BUILTIN, user, fetchFn)
    expect((await lib.addGoogle('Bungee')).faces.map((x) => x.weight)).toEqual([400])
    await expect(lib.addGoogle('Not A Real Font')).rejects.toThrow(/Google Fonts has no font called "Not A Real Font"/)
  })

  it('adds a font file the user picked, named after the file', async () => {
    const user = mkdtempSync(join(tmpdir(), 'pedit-fonts-'))
    const src = join(mkdtempSync(join(tmpdir(), 'pedit-ff-')), 'My-Brand_Font.ttf')
    writeFileSync(src, readFileSync(join(BUILTIN, 'Lobster-400.ttf')))
    const lib = new FontLibrary(BUILTIN, user)
    const f = await lib.addFile(src)
    expect(f).toMatchObject({ family: 'My Brand Font', source: 'user', category: 'custom' })
    expect(existsSync(f.faces[0].path)).toBe(true)
    expect(f.faces[0].path.startsWith(user)).toBe(true)
  })

  it('finds a font by name ignoring case', async () => {
    const lib = new FontLibrary(BUILTIN, mkdtempSync(join(tmpdir(), 'pedit-fonts-')))
    expect(await lib.find('bebas neue')).toMatchObject({ family: 'Bebas Neue' })
    expect(await lib.find('nope')).toBeNull()
  })
})

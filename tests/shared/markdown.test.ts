import { describe, it, expect } from 'vitest'
import { parseMarkdown, parseInline } from '@shared/markdown'

describe('chat markdown', () => {
  it('reads paragraphs with line breaks, and leaves plain text alone', () => {
    expect(parseMarkdown('Done.\nThe title is on.\n\nNext step')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Done.' }, { t: 'br' }, { t: 'text', v: 'The title is on.' }] },
      { t: 'p', c: [{ t: 'text', v: 'Next step' }] }
    ])
  })

  it('reads bold, italic, code and links', () => {
    expect(parseInline('**Bold** and *soft* with `seg_07`, see [docs](https://x.y)')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'Bold' }] },
      { t: 'text', v: ' and ' },
      { t: 'em', c: [{ t: 'text', v: 'soft' }] },
      { t: 'text', v: ' with ' },
      { t: 'code', v: 'seg_07' },
      { t: 'text', v: ', see ' },
      { t: 'link', c: [{ t: 'text', v: 'docs' }], href: 'https://x.y' }
    ])
  })

  it('keeps snake_case names, lone asterisks and escaped characters as text', () => {
    expect(parseInline('use look_at_media on clip_03')).toEqual([{ t: 'text', v: 'use look_at_media on clip_03' }])
    expect(parseInline('5 * 3 = 15')).toEqual([{ t: 'text', v: '5 * 3 = 15' }])
    expect(parseInline('\\*not italic\\*')).toEqual([{ t: 'text', v: '*not italic*' }])
  })

  it('reads headings, lists, quotes, rules and code blocks', () => {
    const b = parseMarkdown('## Plan\n- trim the intro\n- add music\n  under the speech\n\n3. three\n4. four\n\n> note\n\n---\n```json\n{"a": 1}\n```')
    expect(b.map((x) => x.t)).toEqual(['h', 'list', 'list', 'quote', 'hr', 'code'])
    expect(b[0]).toEqual({ t: 'h', level: 2, c: [{ t: 'text', v: 'Plan' }] })
    expect(b[1]).toMatchObject({ ordered: false, items: [[{ v: 'trim the intro' }], [{ v: 'add music' }, { t: 'br' }, { v: 'under the speech' }]] })
    expect(b[2]).toMatchObject({ ordered: true, start: 3 })
    expect(b[5]).toEqual({ t: 'code', lang: 'json', v: '{"a": 1}' })
  })

  it('reads a list straight after a paragraph line', () => {
    expect(parseMarkdown('I changed:\n- the title\n- the music').map((x) => x.t)).toEqual(['p', 'list'])
  })

  it('reads pipe tables', () => {
    const [t] = parseMarkdown('| Clip | Length |\n|---|---:|\n| a | 2s |\n| b | 3s |')
    expect(t).toMatchObject({ t: 'table', head: [[{ v: 'Clip' }], [{ v: 'Length' }]], rows: [[[{ v: 'a' }], [{ v: '2s' }]], [[{ v: 'b' }], [{ v: '3s' }]]] })
  })

  it('treats an unclosed code fence as code to the end', () => {
    expect(parseMarkdown('```\nline 1\nline 2')).toEqual([{ t: 'code', lang: '', v: 'line 1\nline 2' }])
  })
})

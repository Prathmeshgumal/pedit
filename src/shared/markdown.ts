/**
 * A small Markdown reader for Claude's chat replies. It covers what Claude writes in short answers
 * (paragraphs, headings, lists, code, quotes, tables, bold/italic/code/links) and nothing else,
 * and it never produces HTML: the chat renders these blocks as React elements.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; c: Inline[]; href: string }
  | { t: 'br' }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { t: 'quote'; c: Block[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*[-*•+]\s+(.*)$/
const ORDERED = /^\s*(\d{1,4})[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** Splits Claude's text into blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++ // the closing fence (or the end of the text)
      out.push({ t: 'code', lang: fence[2], v: body.join('\n') })
      continue
    }

    const h = HEADING.exec(line)
    if (h) { out.push({ t: 'h', level: Math.min(3, h[1].length) as 1 | 2 | 3, c: parseInline(h[2]) }); i++; continue }

    if (HR.test(line)) { out.push({ t: 'hr' }); i++; continue }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1])
      out.push({ t: 'quote', c: parseMarkdown(body.join('\n')) })
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(line).map(parseInline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]).map(parseInline))
      out.push({ t: 'table', head, rows })
      continue
    }

    const bullet = BULLET.exec(line), ordered = ORDERED.exec(line)
    if (bullet || ordered) {
      const isOrdered = !bullet
      const re = isOrdered ? ORDERED : BULLET
      const items: string[] = []
      while (i < lines.length) {
        const m = re.exec(lines[i])
        if (m) { items.push(isOrdered ? m[2] : m[1]); i++; continue }
        // an indented line continues the item above it
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !ORDERED.test(lines[i])) { items[items.length - 1] += '\n' + lines[i].trim(); i++; continue }
        break
      }
      out.push({ t: 'list', ordered: isOrdered, start: isOrdered ? Number(ordered![1]) : 1, items: items.map(parseInline) })
      continue
    }

    // a paragraph runs until a blank line or the start of another block
    const body: string[] = []
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !QUOTE.test(lines[i])
      && !(body.length && (BULLET.test(lines[i]) || ORDERED.test(lines[i]) || HR.test(lines[i])))) body.push(lines[i++])
    out.push({ t: 'p', c: parseInline(body.join('\n')) })
  }
  return out
}

/** Bold, italic, `code`, [links](url) and line breaks inside one block. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (): void => { if (text) { out.push({ t: 'text', v: text }); text = '' } }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#|>-]/.test(src[i + 1])) { text += src[i + 1]; i += 2; continue }
    if (ch === '\n') { flush(); out.push({ t: 'br' }); i++; continue }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) { flush(); out.push({ t: 'code', v: src.slice(i + 1, end) }); i = end + 1; continue }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2)
      if (end > i + 2) { flush(); out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue }
    }
    if (ch === '*' || ch === '_') {
      // `_` only opens emphasis at a word start, so snake_case names stay as they are
      const opens = src[i + 1] && src[i + 1] !== ' ' && (ch === '*' || i === 0 || /\W/.test(src[i - 1]))
      const end = opens ? findClose(src, ch, i + 1) : -1
      if (end > i + 1) { flush(); out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) }); i = end + 1; continue }
    }
    if (ch === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i))
      if (m) { flush(); out.push({ t: 'link', c: parseInline(m[1]), href: m[2] }); i += m[0].length; continue }
    }
    text += ch
    i++
  }
  flush()
  return out
}

function findClose(src: string, ch: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\n') return -1
    if (src[j] === ch && src[j - 1] !== ' ' && src[j + 1] !== ch && (ch === '*' || j + 1 >= src.length || /\W/.test(src[j + 1]))) return j
  }
  return -1
}

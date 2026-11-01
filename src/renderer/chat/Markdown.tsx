import { useState, type ReactNode } from 'react'
import { parseMarkdown, parseInline, type Block, type Inline } from '@shared/markdown'

/** Claude's reply as formatted text: paragraphs, headings, lists, code, quotes and tables. */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{parseMarkdown(text).map((b, i) => <BlockView key={i} b={b} />)}</div>
}

/** One line of text with inline formatting only (for short system notes). */
export function InlineText({ text }: { text: string }) {
  return <>{inline(parseInline(text))}</>
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case 'p': return <p>{inline(b.c)}</p>
    case 'h': return b.level === 1 ? <h3>{inline(b.c)}</h3> : b.level === 2 ? <h4>{inline(b.c)}</h4> : <h5>{inline(b.c)}</h5>
    case 'hr': return <hr />
    case 'quote': return <blockquote>{b.c.map((x, i) => <BlockView key={i} b={x} />)}</blockquote>
    case 'code': return <CodeBlock lang={b.lang} code={b.v} />
    case 'list': {
      const items = b.items.map((it, i) => <li key={i}>{inline(it)}</li>)
      return b.ordered ? <ol start={b.start}>{items}</ol> : <ul>{items}</ul>
    }
    case 'table': return (
      <div className="md-table">
        <table>
          <thead><tr>{b.head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
}

function inline(xs: Inline[]): ReactNode[] {
  return xs.map((x, i) => {
    switch (x.t) {
      case 'text': return <span key={i}>{x.v}</span>
      case 'br': return <br key={i} />
      case 'code': return <code key={i}>{x.v}</code>
      case 'strong': return <strong key={i}>{inline(x.c)}</strong>
      case 'em': return <em key={i}>{inline(x.c)}</em>
      // links are shown, not followed: clicking one would navigate the editor window away
      case 'link': return <span key={i} className="md-link" title={x.href}>{inline(x.c)}</span>
    }
  })
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = (): void => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }) }
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'text'}</span>
        <button onClick={copy} aria-label="Copy code">{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

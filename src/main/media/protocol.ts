import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { extname } from 'node:path'

import { MEDIA_SCHEME } from '../../shared/mediaUrl'
export { MEDIA_SCHEME, mediaUrl } from '../../shared/mediaUrl'

/** undefined = no Range header; null = unsatisfiable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | undefined {
  if (!header) return undefined
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  let start: number
  let end: number
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1 }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) }
  if (start >= size || start > end) return null
  return { start, end }
}

const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.png': 'image/png', '.mp3': 'audio/mpeg' }

function electron(): typeof import('electron') {
  return createRequire(import.meta.url)('electron') as typeof import('electron')
}

/** Call before app 'ready'. */
export function registerMediaScheme(): void {
  electron().protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

/** Call after app 'ready'. */
export function registerMediaProtocol(): void {
  electron().protocol.handle(MEDIA_SCHEME, async (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname.slice(1))
    let size: number
    try { size = (await stat(path)).size } catch { return new Response('not found', { status: 404 }) }
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const r = parseRange(req.headers.get('range'), size)
    const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
    if (r === null) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    const { start, end } = r ?? { start: 0, end: size - 1 }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: r ? 206 : 200,
      headers: { ...headers, 'Content-Length': String(end - start + 1), ...(r ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) }
    })
  })
}

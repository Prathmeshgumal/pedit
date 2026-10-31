import { createServer, type IncomingMessage } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, rename, writeFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { EditSession } from '../../shared/session'
import { registerTools } from './tools'

export interface McpHandle { url: string; token: string; port: number; close(): Promise<void>; writeConfig(file: string): Promise<void> }

const readBody = (req: IncomingMessage): Promise<unknown> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined) } catch (e) { reject(e) } })
  req.on('error', reject)
})

/** Local MCP server (127.0.0.1, random port, bearer token) exposing pedit's editor tools. Stateless streamable HTTP. */
export async function startMcpServer(getSession: () => EditSession | null): Promise<McpHandle> {
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const authorized = (req: IncomingMessage): boolean => {
    const got = Buffer.from(req.headers.authorization ?? '')
    return got.length === expected.length && timingSafeEqual(got, expected)
  }
  const http = createServer(async (req, res) => {
    if (!authorized(req)) { res.writeHead(401).end('unauthorized'); return }
    if (!req.url?.startsWith('/mcp')) { res.writeHead(404).end(); return }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return }
    try {
      const body = await readBody(req)
      const server = new McpServer({ name: 'pedit', version: '0.1.0' })
      registerTools(server, getSession)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => { void transport.close(); void server.close() })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (e) {
      if (!res.headersSent) res.writeHead(400).end(String(e))
    }
  })
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  const port = (http.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}/mcp`
  return {
    url, token, port,
    close: () => new Promise((r) => { http.closeAllConnections(); http.close(() => r()) }),
    // write a fresh private file and swap it in, so the token is never in a file others can read
    writeConfig: async (file) => {
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ mcpServers: { pedit: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2), { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, file)
    }
  }
}

/**
 * Same-origin edge for cluster-web: binds EDGE_PORT on 0.0.0.0 (the only
 * non-loopback listener in the topology) and reverse-proxies to loopback
 * upstreams. Preserves the browser Host; round-robins `/api` (and `/api/*`)
 * across API replicas; routes `/`, static assets, and `/plugins` to the shell
 * (STATIC_UPSTREAM) so SPA injection and launch-token exchange stay off API-only
 * replicas.
 *
 * Env:
 * - `EDGE_PORT`
 * - `STATIC_UPSTREAM` — `host:port` for shell (default `127.0.0.1:3079`)
 * - `API_UPSTREAMS` — comma-separated API `host:port` list
 * - `UPSTREAMS` — legacy alias for `API_UPSTREAMS` when the latter is unset
 *
 * @module
 */

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { Socket } from 'node:net'
import { parseHostPort, pickUpstream } from './upstream.mts'

const edgePort = Number(process.env.EDGE_PORT ?? '8080')
const staticUpstreamRaw = (process.env.STATIC_UPSTREAM ?? '127.0.0.1:3079').trim()
const apiUpstreamsRaw = (process.env.API_UPSTREAMS ?? process.env.UPSTREAMS ?? '127.0.0.1:3080')
  .split(',')
  .map(entry => entry.trim())
  .filter(entry => entry.length > 0)

if (!Number.isFinite(edgePort) || edgePort <= 0) {
  console.error('cluster-web-edge: EDGE_PORT must be a positive number')
  process.exit(2)
}
if (staticUpstreamRaw.length === 0) {
  console.error('cluster-web-edge: STATIC_UPSTREAM must be host:port')
  process.exit(2)
}
if (apiUpstreamsRaw.length === 0) {
  console.error('cluster-web-edge: API_UPSTREAMS (or UPSTREAMS) must list at least one host:port')
  process.exit(2)
}

const staticUpstream = parseHostPort(staticUpstreamRaw)
const apiUpstreams = apiUpstreamsRaw.map(parseHostPort)
const apiCursor = { value: 0 }

function choose(urlPath: string): { host: string, port: number } {
  return pickUpstream(urlPath, staticUpstream, apiUpstreams, apiCursor)
}

function forwardHeaders(req: IncomingMessage): NodeJS.Dict<string | string[] | undefined> {
  return { ...req.headers, host: req.headers.host }
}

function proxyHttp(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = req.url ?? '/'
  const { host, port } = choose(urlPath)
  const proxyReq = httpRequest(
    { hostname: host, port, path: urlPath, method: req.method, headers: forwardHeaders(req) },
    proxyRes => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', error => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`cluster-web-edge: upstream error: ${error instanceof Error ? error.message : String(error)}`)
  })
  req.pipe(proxyReq)
}

const server = createServer(proxyHttp)

server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const urlPath = req.url ?? '/'
  const { host, port } = choose(urlPath)
  const proxyReq = httpRequest({
    hostname: host,
    port,
    path: urlPath,
    method: req.method,
    headers: forwardHeaders(req),
  })
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`]
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`)
      else lines.push(`${key}: ${value}`)
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length > 0) proxySocket.write(head)
    if (proxyHead.length > 0) socket.write(proxyHead)
    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
  })
  proxyReq.on('error', () => {
    socket.destroy()
  })
  proxyReq.end()
})

server.listen(edgePort, '0.0.0.0', () => {
  console.log(
    `cluster-web-edge: ready on 0.0.0.0:${String(edgePort)} `
    + `static=${staticUpstreamRaw} api=${apiUpstreamsRaw.join(',')}`,
  )
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

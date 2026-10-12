/**
 * In-network HTTP forwarder for API containers (S47): binds FORWARD_PORT on
 * 0.0.0.0 (Docker network only when the compose port is not published) and
 * proxies every request to loopback dsh. Keeps `dsh --host 0.0.0.0` forbidden.
 *
 * Env:
 * - `FORWARD_PORT` (default 3080)
 * - `LOOPBACK_UPSTREAM` — `host:port` for dsh (default `127.0.0.1:13080`)
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
import { parseHostPort } from './upstream.mts'

const forwardPort = Number(process.env.FORWARD_PORT ?? '3080')
const loopbackRaw = (process.env.LOOPBACK_UPSTREAM ?? '127.0.0.1:13080').trim()

if (!Number.isFinite(forwardPort) || forwardPort <= 0) {
  console.error('cluster-web-forward: FORWARD_PORT must be a positive number')
  process.exit(2)
}
if (loopbackRaw.length === 0) {
  console.error('cluster-web-forward: LOOPBACK_UPSTREAM must be host:port')
  process.exit(2)
}

const upstream = parseHostPort(loopbackRaw)

function forwardHeaders(req: IncomingMessage): NodeJS.Dict<string | string[] | undefined> {
  return { ...req.headers, host: req.headers.host }
}

function proxyHttp(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = req.url ?? '/'
  const proxyReq = httpRequest(
    {
      hostname: upstream.host,
      port: upstream.port,
      path: urlPath,
      method: req.method,
      headers: forwardHeaders(req),
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', error => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`cluster-web-forward: upstream error: ${error instanceof Error ? error.message : String(error)}`)
  })
  req.pipe(proxyReq)
}

const server = createServer(proxyHttp)

server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const urlPath = req.url ?? '/'
  const proxyReq = httpRequest({
    hostname: upstream.host,
    port: upstream.port,
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

server.listen(forwardPort, '0.0.0.0', () => {
  console.log(
    `cluster-web-forward: ready on 0.0.0.0:${String(forwardPort)} → ${loopbackRaw}`,
  )
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

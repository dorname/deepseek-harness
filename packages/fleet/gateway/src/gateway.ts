/**
 * The fleet gateway: an OIDC-authenticated reverse proxy in front of the
 * fleet's user processes.
 *
 * One gateway server serves every user. Authentication is the OIDC
 * authorization-code flow (the provider hosts the login page); the gateway
 * keeps a signed session cookie binding the browser to its subject, routes
 * every request — including protocol upgrades — to that subject's own
 * process, and has no code path that routes to another subject's process.
 * Process launch tokens stay on the loopback: the gateway exchanges each
 * process's launch token for that process's browser-session cookie once,
 * keeps the cookie in a per-subject jar, and forwards no cookie outward
 * other than its own gateway session.
 *
 * @module
 */

import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { EnsureOutcome } from '@deepseek-ai/dsh-fleet-manager'
import { resolveGatewayConfig } from './config.ts'
import type { GatewayConfig } from './config.ts'
import { buildAuthorizationUrl, discoverOidc, exchangeCodeForSubject } from './oidc.ts'
import type { FetchLike, OidcEndpoints } from './oidc.ts'
import { GatewaySessions, sessionCookie } from './session.ts'

/** Ten minutes; a login attempt older than this is stale and discarded. */
const STATE_TTL_MS = 10 * 60 * 1000

/** Hop-by-hop headers a reverse proxy never forwards on ordinary requests. */
const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

/** The fixed gateway callback path under the public URL. */
const CALLBACK_PATH = '/auth/callback'

/** A login attempt in flight: the CSRF state and where to return. */
interface PendingLogin {
  redirectTo: string
  expiresAt: number
}

/** The subject process's browser-session cookie, obtained on the loopback only. */
interface ProcessCookieJar {
  cookie: string
}

/**
 * The face of the fleet manager the gateway consumes: provisioning decisions
 * and process observation. `FleetManager` implements it; tests substitute
 * their own registry.
 */
export interface FleetProcessSource {
  /** Ensure the subject's process is running (lazy provisioning, limits, restarts). */
  ensureProcess(subject: string): Promise<EnsureOutcome>
  /** Observe one subject's registered process: port, pid, home, and launch URL. */
  processInfo(subject: string): { port: number; pid: number | undefined; home: string; launchUrl: string } | undefined
}

/** Construction seams; every field has a production default. */
export interface FleetGatewayOptions {
  /** Fleet manager owning the user processes; the gateway never spawns directly. */
  fleetManager: FleetProcessSource
  /** HTTP seam for OIDC discovery and token exchange (test hook). */
  fetchImpl?: FetchLike
  /** Pre-discovered provider endpoints; skips discovery when provided (test hook). */
  endpoints?: OidcEndpoints
  /** Clock seam (test hook). */
  now?: () => number
}

/**
 * Owns the gateway HTTP server: login flow, session verification, and
 * per-subject reverse proxying. Construct with deployment config and a
 * running fleet manager; call {@link start} and later {@link dispose}.
 */
export class FleetGateway {
  private readonly config: ReturnType<typeof resolveGatewayConfig>
  private readonly manager: FleetProcessSource
  private readonly sessions: GatewaySessions
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private endpoints: OidcEndpoints | undefined
  private readonly pendingLogins = new Map<string, PendingLogin>()
  private readonly cookieJars = new Map<string, ProcessCookieJar>()
  private server: Server | undefined
  /** Canonical external root; resolved after binding when the port is OS-assigned. */
  private publicUrl: string
  private readonly defaultedPublicUrl: boolean

  constructor(config: Partial<GatewayConfig>, options: FleetGatewayOptions) {
    this.config = resolveGatewayConfig(config)
    this.publicUrl = this.config.publicUrl
    this.defaultedPublicUrl = config.publicUrl === undefined
    this.manager = options.fleetManager
    this.endpoints = options.endpoints
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.sessions = new GatewaySessions(this.config.sessionSecret, this.config.sessionTtlMs, this.now)
  }

  /**
   * Bind the gateway server.
   * @returns the bound port (OS-assigned when the configured port is 0).
   */
  async start(): Promise<{ port: number }> {
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.fail(response, 500, `gateway error: ${String(error)}`)
      })
    })
    server.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head).catch(() => {
        socket.destroy()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.config.port, this.config.host, resolve)
    })
    this.server = server
    // A TCP listen on host/port always reports an AddressInfo once the
    // listening callback has run.
    const port = (server.address() as AddressInfo).port
    if (this.defaultedPublicUrl) {
      // The default public URL was built before binding; pin it to the real
      // bound port so the OIDC redirect_uri reaches this gateway.
      this.publicUrl = `http://${this.config.host}:${String(port)}`
    }
    return { port }
  }

  /** Stop the gateway server. User processes stay owned by the fleet manager. */
  async dispose(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    await new Promise<void>((resolve, reject) => {
      server.close((closeError) => {
        // v8 ignore next -- dispose runs only on a bound server, whose close reports no error.
        if (closeError !== undefined) reject(closeError)
        else resolve()
      })
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // v8 ignore next -- the HTTP server always provides the request target.
    const url = new URL(request.url ?? '/', 'http://gateway.invalid')
    if (url.pathname === CALLBACK_PATH) {
      await this.handleCallback(url, response)
      return
    }
    const session = this.sessions.verify(request.headers.cookie)
    if (session === undefined) {
      await this.redirectToLogin(url, response)
      return
    }
    const outcome = await this.manager.ensureProcess(session.subject)
    if (outcome.kind === 'rejected') {
      this.fail(response, 503, 'fleet at capacity: try again later')
      return
    }
    await this.proxy(request, response, session.subject, outcome.port, url)
  }

  /** Authorization-code callback: verify state, exchange the code, open the session. */
  private async handleCallback(url: URL, response: ServerResponse): Promise<void> {
    const state = url.searchParams.get('state') ?? ''
    const pending = this.pendingLogins.get(state)
    if (pending === undefined || pending.expiresAt <= this.now()) {
      this.pendingLogins.delete(state)
      this.fail(response, 400, 'authentication failed: unknown or expired login state')
      return
    }
    this.pendingLogins.delete(state)
    const code = url.searchParams.get('code')
    if (code === null) {
      this.fail(response, 401, 'authentication failed: the identity provider did not authorize the login')
      return
    }
    const endpoints = await this.ensureEndpoints()
    let subject: string
    try {
      subject = await exchangeCodeForSubject(endpoints, {
        issuer: this.config.oidc.issuer,
        clientId: this.config.oidc.clientId,
        clientSecret: this.config.oidc.clientSecret,
        code,
        redirectUri: `${this.publicUrl}${CALLBACK_PATH}`,
      }, this.fetchImpl)
    } catch (error) {
      this.fail(response, 401, `authentication failed: ${String(error)}`)
      return
    }
    const issued = this.sessions.issue(subject)
    response.writeHead(303, {
      'cache-control': 'no-store',
      'location': pending.redirectTo,
      'set-cookie': sessionCookie(issued.value, issued.expiresAt, Math.floor(this.config.sessionTtlMs / 1000)),
    })
    response.end()
  }

  /** Send the browser to the provider's login page, remembering where it came from. */
  private async redirectToLogin(url: URL, response: ServerResponse): Promise<void> {
    const endpoints = await this.ensureEndpoints()
    const state = randomBytes(16).toString('base64url')
    this.pruneExpiredLogins()
    this.pendingLogins.set(state, { redirectTo: url.pathname + url.search, expiresAt: this.now() + STATE_TTL_MS })
    response.writeHead(302, {
      'cache-control': 'no-store',
      'location': buildAuthorizationUrl(endpoints, {
        clientId: this.config.oidc.clientId,
        redirectUri: `${this.publicUrl}${CALLBACK_PATH}`,
        state,
      }),
    })
    response.end()
  }

  private pruneExpiredLogins(): void {
    const now = this.now()
    for (const [state, pending] of this.pendingLogins) {
      if (pending.expiresAt <= now) this.pendingLogins.delete(state)
    }
  }

  private async ensureEndpoints(): Promise<OidcEndpoints> {
    if (this.endpoints === undefined) {
      this.endpoints = await discoverOidc(this.config.oidc.issuer, this.fetchImpl)
    }
    return this.endpoints
  }

  /**
   * Reverse-proxy one authenticated request into the subject's process. The
   * per-subject cookie jar is refilled from the launch token on the loopback
   * when the process rejects the jar — only for bodyless requests, whose
   * replay cannot corrupt an uploaded body. The process's own Set-Cookie
   * headers never reach the browser.
   */
  private async proxy(
    request: IncomingMessage,
    response: ServerResponse,
    subject: string,
    port: number,
    url: URL,
  ): Promise<void> {
    const result = await this.forward(request, response, subject, port, url)
    if (result !== 'exchange-needed') return
    const bodyless = request.method === 'GET' || request.method === 'HEAD'
    if (!bodyless || !await this.exchangeLaunchToken(subject, port)) {
      this.fail(response, 502, 'user process rejected the gateway session')
      return
    }
    await this.forward(request, response, subject, port, url)
  }

  private async forward(
    request: IncomingMessage,
    response: ServerResponse,
    subject: string,
    port: number,
    url: URL,
  ): Promise<'forwarded' | 'exchange-needed'> {
    const jar = this.cookieJars.get(subject)
    const headers: Record<string, string> = {}
    const entries = Object.entries(request.headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .filter(([name]) => {
        const lower = name.toLowerCase()
        return !HOP_BY_HOP_HEADERS.has(lower) && lower !== 'host' && lower !== 'cookie'
      })
    for (const [name, value] of entries) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value
    }
    headers.host = `127.0.0.1:${String(port)}`
    headers['x-forwarded-host'] = url.host
    headers['x-forwarded-proto'] = 'http'
    if (jar !== undefined) headers.cookie = jar.cookie
    const target = httpRequest({
      host: '127.0.0.1',
      port,
      method: request.method,
      path: request.url,
      headers,
    })
    request.pipe(target)
    return await new Promise<'forwarded' | 'exchange-needed'>((resolve) => {
      target.on('error', () => {
        // v8 ignore next -- a mid-relay socket reset cannot be produced deterministically.
        if (!response.headersSent) this.fail(response, 502, 'user process is unreachable')
        resolve('forwarded')
      })
      target.on('response', (upstream) => {
        if (upstream.statusCode === 401) {
          upstream.resume()
          resolve('exchange-needed')
          return
        }
        this.relayResponse(upstream, response)
        resolve('forwarded')
      })
    })
  }

  /** Pipe one upstream response to the browser, minus loopback-only cookies. */
  private relayResponse(upstream: IncomingMessage, response: ServerResponse): void {
    const outHeaders = Object.fromEntries(
      Object.entries(upstream.headers)
        .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
        .filter(([name]) => name.toLowerCase() !== 'set-cookie' && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())),
    )
    // v8 ignore next -- the client emits a response only after parsing a complete status line.
    response.writeHead(upstream.statusCode ?? 502, outHeaders)
    upstream.pipe(response)
    upstream.on('close', () => {
      // An upstream that dies mid-message never completes; the advertised
      // content length can no longer be satisfied, so destroy the browser
      // response instead of leaving the socket half-open.
      if (!upstream.complete) response.destroy()
    })
  }

  /**
   * Exchange the process's launch token for its browser-session cookie, on
   * the loopback only.
   */
  private async exchangeLaunchToken(subject: string, port: number): Promise<boolean> {
    const info = this.manager.processInfo(subject)
    if (info === undefined) return false
    const tokenUrl = new URL(info.launchUrl)
    tokenUrl.protocol = 'http:'
    tokenUrl.host = `127.0.0.1:${String(port)}`
    const exchange = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: `${tokenUrl.pathname}${tokenUrl.search}`,
      headers: { host: `127.0.0.1:${String(port)}`, accept: '*/*' },
    })
    return await new Promise<boolean>((resolve) => {
      exchange.on('error', () => {
        resolve(false)
      })
      exchange.on('response', (upstream) => {
        const cookies = upstream.headers['set-cookie']
        if (upstream.statusCode === 303 && cookies !== undefined) {
          this.cookieJars.set(subject, { cookie: cookies.join('; ') })
          resolve(true)
        } else {
          resolve(false)
        }
        upstream.resume()
      })
      exchange.end()
    })
  }

  /**
   * Route one protocol upgrade (WebSocket) into the subject's process over a
   * raw socket pipe. Upgrade/Connection must survive verbatim — they are the
   * handshake — while the Host, cookie, and forwarded headers are rewritten.
   * An upgrade without a gateway session, or before the browser has completed
   * one ordinary request (the launch-token exchange), is refused.
   */
  private async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const session = this.sessions.verify(request.headers.cookie)
    if (session === undefined) {
      socket.destroy()
      return
    }
    const outcome = await this.manager.ensureProcess(session.subject)
    if (outcome.kind === 'rejected') {
      socket.destroy()
      return
    }
    const info = this.manager.processInfo(session.subject)
    const jar = this.cookieJars.get(session.subject)
    if (info === undefined || jar === undefined) {
      socket.destroy()
      return
    }
    const forwardedHeaders = Object.entries(request.headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .filter(([name]) => {
        const lower = name.toLowerCase()
        return lower !== 'host' && lower !== 'cookie'
      })
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
    // v8 ignore next -- the HTTP server always provides the request target.
    const requestLine = `${request.method} ${request.url ?? '/'} HTTP/1.1\r\n`
      + `${forwardedHeaders.join('\r\n')}\r\n`
      + `host: 127.0.0.1:${String(info.port)}\r\n`
      + `cookie: ${jar.cookie}\r\n`
      // v8 ignore next -- an HTTP/1.1 request without Host is rejected before
      // the upgrade event fires, so the original host is always present.
      + `x-forwarded-host: ${request.headers.host ?? ''}\r\n`
      + 'x-forwarded-proto: http\r\n\r\n'
    const upstream = connect({ host: '127.0.0.1', port: info.port })
    const abort = (): void => {
      socket.destroy()
      upstream.destroy()
    }
    upstream.on('error', abort)
    socket.on('error', abort)
    upstream.write(requestLine)
    if (head.length > 0) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  }

  private fail(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`${message}\n`)
  }
}

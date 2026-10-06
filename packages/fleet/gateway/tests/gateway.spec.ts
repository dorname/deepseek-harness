import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FleetManager } from '@deepseek-ai/dsh-fleet-manager'
import { resolveGatewayConfig } from '../src/config.ts'
import { FleetGateway } from '../src/gateway.ts'
import type { FleetProcessSource } from '../src/gateway.ts'
import { buildAuthorizationUrl, discoverOidc, exchangeCodeForSubject, extractSubject } from '../src/oidc.ts'
import type { FetchLike } from '../src/oidc.ts'
import { GATEWAY_COOKIE_NAME, GatewaySessions, cookieValue } from '../src/session.ts'
import { reportResult } from './helpers/reporter.ts'

const tempDirs: string[] = []
const childProcesses: { kill: () => void }[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  for (const child of childProcesses.splice(0)) {
    child.kill()
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-gateway-'))
  tempDirs.push(dir)
  return dir
}

/** Base64url payload mint mirroring the test provider's unsigned ID-token shape. */
function mintIdToken(payload: Record<string, unknown>): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

describe('resolveGatewayConfig', () => {
  const oidc = { issuer: 'https://idp.example', clientId: 'client', clientSecret: 'secret' }
  const secret = 'a'.repeat(43)

  it('applies documented defaults and keeps provided values', () => {
    const config = resolveGatewayConfig({ homesDir: '/data/homes', oidc, sessionSecret: secret })
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(0)
    expect(config.sessionTtlMs).toBe(12 * 60 * 60 * 1000)
    expect(config.sessionSecret).toBe(secret)
    expect(config.publicUrl).toBe('http://127.0.0.1')
    const onExplicitPort = resolveGatewayConfig({ homesDir: '/data/homes', oidc, host: '0.0.0.0', port: 3080 })
    expect(onExplicitPort.publicUrl).toBe('http://0.0.0.0:3080')
  })

  it('generates a valid per-process session secret when none is configured', () => {
    const config = resolveGatewayConfig({ homesDir: '/data/homes', oidc })
    expect(config.sessionSecret).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  })

  it('fails loud on every invalid field', () => {
    expect(() => resolveGatewayConfig({ oidc })).toThrow('homesDir is required')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, port: -1 })).toThrow('port')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, port: 70000 })).toThrow('port')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, port: 1.5 })).toThrow('port')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, sessionTtlMs: 0 })).toThrow('sessionTtlMs')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, sessionTtlMs: 1.5 })).toThrow('sessionTtlMs')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, sessionTtlMs: 31 * 24 * 60 * 60 * 1000 })).toThrow('sessionTtlMs')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, sessionSecret: 'short' })).toThrow('sessionSecret')
    expect(() => resolveGatewayConfig({ homesDir: '/h' })).toThrow('oidc is required')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc: { ...oidc, issuer: 'not a url' } })).toThrow('issuer')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc: { ...oidc, issuer: 'mailto:idp' } })).toThrow('issuer')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc: { issuer: 'https://idp.example', clientId: '', clientSecret: 's' } })).toThrow('clientId')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc: { issuer: 'https://idp.example', clientId: 'c', clientSecret: '' } })).toThrow('clientSecret')
    expect(() => resolveGatewayConfig({ homesDir: '/h', oidc, publicUrl: 'not a url' })).toThrow('publicUrl')
  })
})

describe('GatewaySessions', () => {
  const secret = 'b'.repeat(43)

  it('issues a cookie that verifies back to the subject', () => {
    const sessions = new GatewaySessions(secret, 60_000)
    const issued = sessions.issue('user-a')
    const verified = sessions.verify(`${GATEWAY_COOKIE_NAME}=${issued.value}`)
    expect(verified).toEqual({ subject: 'user-a' })
    expect(cookieValue(`${GATEWAY_COOKIE_NAME}=${issued.value}; other=x`, GATEWAY_COOKIE_NAME)).toBe(issued.value)
    expect(cookieValue('other=1; novalue', GATEWAY_COOKIE_NAME)).toBeUndefined()
  })

  it('rejects tampered, foreign-keyed, malformed, and expired cookies', () => {
    const sessions = new GatewaySessions(secret, 60_000)
    const issued = sessions.issue('user-a')
    const tampered = issued.value.replace(/.$/u, issued.value.endsWith('a') ? 'b' : 'a')
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${tampered}`)).toBeUndefined()
    // A foreign version under an otherwise intact value.
    const [ , bodyPart, signaturePart ] = issued.value.split('.')
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=v2.${bodyPart}.${signaturePart}`)).toBeUndefined()
    expect(new GatewaySessions('c'.repeat(43), 60_000).verify(`${GATEWAY_COOKIE_NAME}=${issued.value}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=not-a-session`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}==`)).toBeUndefined()
    expect(sessions.verify(undefined)).toBeUndefined()
    // A signature segment that is not valid base64url.
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${issued.value.slice(0, -1)}=`)).toBeUndefined()
    // A signature segment whose length is not a base64url shape.
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=v1.${bodyPart}.a`)).toBeUndefined()
    const clock = vi.fn(() => 0)
    const timed = new GatewaySessions(secret, 60_000, clock)
    const value = timed.issue('user-a').value
    clock.mockReturnValue(61_000)
    expect(timed.verify(`${GATEWAY_COOKIE_NAME}=${value}`)).toBeUndefined()
  })

  it('rejects structurally invalid payloads that carry a valid signature', () => {
    const sessions = new GatewaySessions(secret, 60_000)
    const key = Buffer.from(secret, 'base64')
    const seal = (payload: Record<string, unknown>): string => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const signature = createHmac('sha256', key).update(body).digest().toString('base64url')
      return `v1.${body}.${signature}`
    }
    const now = Date.now()
    const valid = { subject: 'user-a', issuedAt: now, expiresAt: now + 60_000 }
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal(valid)}`)).toEqual({ subject: 'user-a' })
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal({ ...valid, subject: 42 })}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal({ ...valid, subject: '' })}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal({ ...valid, issuedAt: '0' })}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal({ ...valid, expiresAt: 1.5 })}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal({ ...valid, issuedAt: now + 100 })}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal({ ...valid, expiresAt: now - 1 })}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${seal({ ...valid, expiresAt: now + 120_000 })}`)).toBeUndefined()
    const notJson = Buffer.from('{oops').toString('base64url')
    const signature = createHmac('sha256', key).update(notJson).digest().toString('base64url')
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=v1.${notJson}.${signature}`)).toBeUndefined()
    // Well-signed bodies that decode but carry no object or no decodable bytes.
    const signRaw = (rawBody: string): string => {
      const body = Buffer.from(rawBody).toString('base64url')
      return `v1.${body}.${createHmac('sha256', key).update(body).digest().toString('base64url')}`
    }
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${signRaw('42')}`)).toBeUndefined()
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${signRaw('null')}`)).toBeUndefined()
    // A signed body segment whose length is not a base64url shape ('b' alone).
    const bodySegment = Buffer.from('{}').toString('base64url').slice(0, 1)
    const signed = `v1.${bodySegment}.${createHmac('sha256', key).update(bodySegment).digest().toString('base64url')}`
    expect(sessions.verify(`${GATEWAY_COOKIE_NAME}=${signed}`)).toBeUndefined()
  })
})

describe('oidc helpers', () => {
  const endpoints = { authorizationEndpoint: 'https://idp.example/auth', tokenEndpoint: 'https://idp.example/token' }

  it('builds the authorization redirect with the code-flow parameters', () => {
    const url = new URL(buildAuthorizationUrl(endpoints, { clientId: 'client', redirectUri: 'https://gw.example/auth/callback', state: 'st1' }))
    expect(url.href.startsWith('https://idp.example/auth?')).toBe(true)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid')
    expect(url.searchParams.get('client_id')).toBe('client')
    expect(url.searchParams.get('redirect_uri')).toBe('https://gw.example/auth/callback')
    expect(url.searchParams.get('state')).toBe('st1')
  })

  it('extracts the subject from a claims-valid ID token, including audience arrays', () => {
    const token = mintIdToken({ iss: 'https://idp.example', aud: ['client', 'other'], sub: 'user-a', exp: 10_000 })
    expect(extractSubject(token, { issuer: 'https://idp.example', clientId: 'client' }, 5_000)).toBe('user-a')
  })

  it('fails loud on malformed or claim-mismatched ID tokens', () => {
    const valid = { iss: 'https://idp.example', aud: 'client', sub: 'user-a', exp: 10_000 }
    const expected = { issuer: 'https://idp.example', clientId: 'client' }
    expect(() => extractSubject('not-a-jwt', expected)).toThrow('malformed')
    expect(() => extractSubject('a.b.c', expected)).toThrow('payload')
    const arrayPayload = Buffer.from('["a"]').toString('base64url')
    expect(() => extractSubject(`h.${arrayPayload}.s`, expected)).toThrow('payload')
    expect(() => extractSubject(mintIdToken({ ...valid, iss: 'https://other.example' }), expected, 5_000)).toThrow('issuer')
    expect(() => extractSubject(mintIdToken({ ...valid, aud: 'other-client' }), expected, 5_000)).toThrow('audience')
    expect(() => extractSubject(mintIdToken({ ...valid, exp: 1_000 }), expected, 5_000)).toThrow('expired')
    expect(() => extractSubject(mintIdToken({ iss: 'https://idp.example', aud: 'client', exp: 10_000 }), expected, 5_000)).toThrow('subject')
  })

  it('fails loud on failed discovery and incomplete documents', async () => {
    const ok: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ authorization_endpoint: endpoints.authorizationEndpoint, token_endpoint: endpoints.tokenEndpoint }),
      text: async () => '',
    })
    expect(await discoverOidc('https://idp.example', ok)).toEqual(endpoints)
    const failing: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' })
    await expect(discoverOidc('https://idp.example', failing)).rejects.toThrow('discovery')
    const incomplete: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
    await expect(discoverOidc('https://idp.example', incomplete)).rejects.toThrow('authorization-code flow')
  })

  it('exchanges a code and fails loud on exchange failures', async () => {
    const request = { issuer: 'https://idp.example', clientId: 'client', clientSecret: 's', code: 'c', redirectUri: 'https://gw.example/auth/callback' }
    const ok: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id_token: mintIdToken({ iss: 'https://idp.example', aud: 'client', sub: 'user-a', exp: Math.floor(Date.now() / 1000) + 300 }),
      }),
      text: async () => '',
    })
    expect(await exchangeCodeForSubject(endpoints, request, ok)).toBe('user-a')
    const failing: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' })
    await expect(exchangeCodeForSubject(endpoints, request, failing)).rejects.toThrow('token exchange')
    const noToken: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
    await expect(exchangeCodeForSubject(endpoints, request, noToken)).rejects.toThrow('no ID token')
  })
})

/** In-process stand-in for one user's dsh web process, with request logging. */
interface FakeUserProcess {
  port: number
  readonly launchUrl: string
  requests: string[]
  rotateToken: () => void
  close: () => Promise<void>
}

async function startFakeUserProcess(subject: string): Promise<FakeUserProcess> {
  const { createServer } = await import('node:http')
  let launchToken = `fake-${subject}`
  const requests: string[] = []
  const cookieName = `dsh-auth-${subject}`
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://process.invalid')
    requests.push(request.url ?? '/')
    const token = url.searchParams.get('token')
    if (token !== null) {
      if (token === 'reset') {
        // Kill the exchange connection with a hard reset and no response, the
        // way a process dying between a rejected jar and the exchange behaves.
        response.socket.resetAndDestroy()
        return
      }
      if (token === 'bare-303') {
        // A redirect that carries no session cookie fails the jar exchange.
        response.writeHead(303, { location: './' })
        response.end()
        return
      }
      if (token === launchToken) {
        // The minted browser-session cookie is bound to the current token, so
        // rotating the token invalidates every jar that predates it.
        response.writeHead(303, {
          location: './',
          'set-cookie': `${cookieName}=ok-${launchToken}; Path=/; HttpOnly; SameSite=Strict`,
        })
      } else {
        response.writeHead(401)
      }
      response.end()
      return
    }
    if (!(request.headers.cookie ?? '').includes(`${cookieName}=ok-${launchToken}`)) {
      response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('unauthorized\n')
      return
    }
    if (url.pathname === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: events-${subject}\n\n`)
      return
    }
    if (url.pathname === '/profile') {
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': `process-refresh-${subject}=internal; Path=/; HttpOnly`,
        'keep-alive': 'timeout=5',
      })
      response.end(`${subject} profile\n`)
      return
    }
    if (url.pathname === '/half-then-die') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': '100' })
      response.write('partial')
      // Flush the head out before the socket dies, so the gateway relays a
      // real response that then truncates.
      response.flushHeaders()
      setTimeout(() => {
        response.destroy()
      }, 10)
      return
    }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`${subject} home ${url.pathname}\n`)
  })
  server.on('upgrade', (request, socket) => {
    requests.push(`upgrade ${request.url ?? '/'}`)
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\nupgraded-${subject}`)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as { port: number }).port
  return {
    port,
    get launchUrl(): string {
      return `http://127.0.0.1:${String(port)}/?token=${launchToken}`
    },
    requests,
    rotateToken: () => {
      launchToken = `fake-${subject}-${Math.random()}`
    },
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
      server.closeAllConnections()
    },
  }
}

/** In-memory fleet registry feeding the gateway during unit tests. */
class FakeRegistry implements FleetProcessSource {
  ensureCalls: string[] = []
  /** Overrides for driving the launch-token exchange down its failure paths. */
  launchUrlOverride: string | undefined
  hideProcessInfo = false
  throwOnEnsure = false

  private readonly processes = new Map<string, FakeUserProcess>()
  private readonly deadPorts = new Map<string, number>()

  constructor(private readonly maxProcesses = Number.POSITIVE_INFINITY) {}

  async ensureProcess(subject: string): Promise<Awaited<ReturnType<FleetProcessSource['ensureProcess']>>> {
    this.ensureCalls.push(subject)
    if (this.throwOnEnsure) {
      throw new Error('registry exploded')
    }
    const deadPort = this.deadPorts.get(subject)
    if (deadPort !== undefined) {
      return { kind: 'ready', subject, port: deadPort, home: `/homes/${subject}` }
    }
    if (!this.processes.has(subject) && this.processes.size >= this.maxProcesses) {
      return { kind: 'rejected', subject, reason: 'limit' }
    }
    let process = this.processes.get(subject)
    if (process === undefined) {
      process = await startFakeUserProcess(subject)
      this.processes.set(subject, process)
    }
    return { kind: 'ready', subject, port: process.port, home: `/homes/${subject}` }
  }

  /** Terminate one live process and remember its port as unreachable. */
  async killProcess(subject: string): Promise<void> {
    const process = this.processes.get(subject)
    if (process === undefined) return
    this.deadPorts.set(subject, process.port)
    this.processes.delete(subject)
    await process.close()
  }

  processInfo(subject: string): { port: number; pid: number | undefined; home: string; launchUrl: string } | undefined {
    if (this.hideProcessInfo) return undefined
    const deadPort = this.deadPorts.get(subject)
    if (deadPort !== undefined) {
      return { port: deadPort, pid: undefined, home: `/homes/${subject}`, launchUrl: `http://127.0.0.1:${String(deadPort)}/?token=x` }
    }
    const process = this.processes.get(subject)
    if (process === undefined) return undefined
    return {
      port: process.port,
      pid: undefined,
      home: `/homes/${subject}`,
      launchUrl: this.launchUrlOverride ?? process.launchUrl,
    }
  }

  fakeProcess(subject: string): FakeUserProcess | undefined {
    return this.processes.get(subject)
  }

  async dispose(): Promise<void> {
    for (const process of this.processes.values()) {
      await process.close()
    }
  }
}

const OIDC = { issuer: 'https://idp.example', clientId: 'client', clientSecret: 'secret' }
const SECRET = 'd'.repeat(43)

/** A token-endpoint seam: the subject travels inside the code, like the test provider. */
const tokenFetch: FetchLike = async (_input, init) => {
  const code = new URLSearchParams(init?.body ?? '').get('code') ?? ''
  if (code.startsWith('deny-')) {
    return { ok: false, status: 401, json: async () => ({}), text: async () => '' }
  }
  const subject = code.startsWith('code-') ? decodeURIComponent(code.slice('code-'.length)) : 'user-a'
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id_token: mintIdToken({ iss: OIDC.issuer, aud: OIDC.clientId, sub: subject, exp: Math.floor(Date.now() / 1000) + 300 }),
    }),
    text: async () => '',
  }
}

const endpoints = { authorizationEndpoint: 'https://idp.example/auth', tokenEndpoint: 'https://idp.example/token' }

interface GatewayFixture {
  url: string
  registry: FakeRegistry
  gateway: FleetGateway
  done: () => Promise<void>
}

async function startGateway(options: {
  maxProcesses?: number
  now?: () => number
  fetchImpl?: FetchLike
  withEndpoints?: boolean
} = {}): Promise<GatewayFixture> {
  const registry = new FakeRegistry(options.maxProcesses)
  const gateway = new FleetGateway(
    { homesDir: tempDir(), oidc: OIDC, sessionSecret: SECRET },
    {
      fleetManager: registry,
      fetchImpl: options.fetchImpl ?? tokenFetch,
      ...(options.withEndpoints === false ? {} : { endpoints }),
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  )
  const { port } = await gateway.start()
  return {
    url: `http://127.0.0.1:${String(port)}`,
    registry,
    gateway,
    done: async () => {
      await gateway.dispose()
      await registry.dispose()
    },
  }
}

/** Browser simulation: follow one redirect chain manually, collecting cookies. */
class Browser {
  cookie: string | undefined

  constructor(private readonly base: string) {}

  async get(path: string): Promise<{ status: number; location: string | undefined; body: string; setCookie: string | undefined }> {
    const response = await fetch(`${this.base}${path}`, { redirect: 'manual', headers: this.cookie === undefined ? {} : { cookie: this.cookie } })
    const setCookie = response.headers.get('set-cookie') ?? undefined
    if (setCookie !== undefined) {
      this.cookie = setCookie.split(';')[0]
    }
    return { status: response.status, location: response.headers.get('location') ?? undefined, body: await response.text(), setCookie }
  }

  /** Log in as one subject through the redirect chain, as the browser would. */
  async loginAs(subject: string, deepLink = '/'): Promise<void> {
    const first = await this.get(deepLink)
    const authorize = new URL(first.location ?? '')
    const target = authorize.searchParams.get('redirect_uri')?.replace(this.base, '') ?? ''
    const callbackPath = `${target}?state=${authorize.searchParams.get('state')}&code=code-${encodeURIComponent(subject)}`
    const callback = await this.get(callbackPath)
    expect(callback.status).toBe(303)
  }
}

describe('FleetGateway login flow (unit)', () => {
  it('UT-S31-01 redirects an unauthenticated deep link to the provider without touching any process', async () => {
    const start = Date.now()
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      const first = await browser.get('/sessions/abc?tab=1')
      expect(first.status).toBe(302)
      const authorize = new URL(first.location ?? '')
      expect(authorize.searchParams.get('response_type')).toBe('code')
      expect(authorize.searchParams.get('client_id')).toBe(OIDC.clientId)
      expect(authorize.searchParams.get('state')).not.toBe('')
      // The post-bind public URL pin: the redirect target must carry the
      // OS-assigned gateway port or the provider's redirect never arrives.
      expect(authorize.searchParams.get('redirect_uri')).toBe(`${fixture.url}/auth/callback`)
      expect(fixture.registry.ensureCalls).toEqual([])
      reportResult('UT-S31-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S31-01', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await fixture.done()
    }
  })

  it('UT-S31-02 exchanges a valid callback into a session routed to that subject', async () => {
    const start = Date.now()
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a', '/sessions/abc')
      const page = await browser.get('/')
      expect(page.status).toBe(200)
      expect(page.body).toBe('user-a home /\n')
      expect(page.setCookie).toBeUndefined()
      expect(fixture.registry.ensureCalls).toContain('user-a')
      reportResult('UT-S31-02', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S31-02', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await fixture.done()
    }
  })

  it('UT-S31-03 refuses unknown states and failed exchanges without a session', async () => {
    const start = Date.now()
    const fixture = await startGateway()
    try {
      const badState = await fetch(`${fixture.url}/auth/callback?state=unknown&code=code-user-a`, { redirect: 'manual' })
      expect(badState.status).toBe(400)
      expect(badState.headers.get('set-cookie')).toBeNull()

      // A callback with no state at all.
      const stateless = await fetch(`${fixture.url}/auth/callback`, { redirect: 'manual' })
      expect(stateless.status).toBe(400)

      // A valid state whose exchange the provider rejects.
      const browser = new Browser(fixture.url)
      const first = await browser.get('/')
      const state = new URL(first.location ?? '').searchParams.get('state')
      const denied = await fetch(`${fixture.url}/auth/callback?state=${state}&code=deny-user-a`, { redirect: 'manual' })
      expect(denied.status).toBe(401)
      expect(denied.headers.get('set-cookie')).toBeNull()

      // A valid state that arrives without a code.
      const second = await browser.get('/')
      const secondState = new URL(second.location ?? '').searchParams.get('state')
      const codeless = await fetch(`${fixture.url}/auth/callback?state=${secondState}`, { redirect: 'manual' })
      expect(codeless.status).toBe(401)

      const after = await browser.get('/')
      expect(after.status).toBe(302)
      reportResult('UT-S31-03', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S31-03', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await fixture.done()
    }
  })

  it('keeps an explicitly configured public URL across the bind', async () => {
    const registry = new FakeRegistry()
    const gateway = new FleetGateway(
      { homesDir: tempDir(), oidc: OIDC, sessionSecret: SECRET, publicUrl: 'https://fleet.example' },
      { fleetManager: registry, endpoints },
    )
    const { port } = await gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`, { redirect: 'manual' })
      const authorize = new URL(response.headers.get('location') ?? '')
      expect(authorize.searchParams.get('redirect_uri')).toBe('https://fleet.example/auth/callback')
    } finally {
      await gateway.dispose()
    }
  })

  it('expires stale login states through the clock seam', async () => {
    let current = 1_000_000_000_000
    const fixture = await startGateway({ now: () => current })
    try {
      const browser = new Browser(fixture.url)
      const first = await browser.get('/')
      // A second redirect while the first attempt is still live: the prune
      // walk must keep it.
      expect((await browser.get('/')).status).toBe(302)
      current += 10 * 60_000 + 1
      const state = new URL(first.location ?? '').searchParams.get('state')
      // The next redirect's prune walk drops the expired attempts.
      expect((await browser.get('/')).status).toBe(302)
      const stale = await fetch(`${fixture.url}/auth/callback?state=${state}`, { redirect: 'manual' })
      expect(stale.status).toBe(400)
    } finally {
      await fixture.done()
    }
  })

  it('answers 500 when the fleet registry fails', async () => {
    const fixture = await startGateway()
    fixture.registry.throwOnEnsure = true
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      const page = await browser.get('/')
      expect(page.status).toBe(500)
      expect(page.body).toContain('gateway error')
    } finally {
      await fixture.done()
    }
  })

  it('answers 500 and stays up when provider discovery fails', async () => {
    const discoveryFails: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' })
    const fixture = await startGateway({ fetchImpl: discoveryFails, withEndpoints: false })
    try {
      const response = await fetch(`${fixture.url}/`, { redirect: 'manual' })
      expect(response.status).toBe(500)
      expect(await response.text()).toContain('gateway error')
      // A later request retries discovery instead of caching the failure.
      expect((await fetch(`${fixture.url}/`, { redirect: 'manual' })).status).toBe(500)
    } finally {
      await fixture.done()
    }
  })

  it('refuses to bind an occupied port', async () => {
    const first = await startGateway()
    try {
      const port = Number(new URL(first.url).port)
      const second = new FleetGateway(
        { homesDir: tempDir(), oidc: OIDC, sessionSecret: SECRET, port },
        { fleetManager: new FakeRegistry(), endpoints },
      )
      await expect(second.start()).rejects.toThrow()
    } finally {
      await first.done()
    }
  })

  it('dispose is idempotent', async () => {
    const fixture = await startGateway()
    await fixture.done()
    await expect(fixture.gateway.dispose()).resolves.toBeUndefined()
  })
})

describe('FleetGateway per-subject routing (unit)', () => {
  it('UT-S32-01 routes every request of a session to its own subject and never to another process', async () => {
    const start = Date.now()
    const fixture = await startGateway()
    try {
      const alice = new Browser(fixture.url)
      const bob = new Browser(fixture.url)
      await alice.loginAs('user-a')
      await alice.get('/alice-page')
      await bob.loginAs('user-b')

      const intruded = await bob.get('/sessions/a-private-session')
      expect(intruded.status).toBe(200)
      expect(intruded.body).toBe('user-b home /sessions/a-private-session\n')
      expect(intruded.body).not.toContain('user-a')
      const aliceLog = fixture.registry.fakeProcess('user-a')?.requests ?? []
      expect(aliceLog).toContain('/alice-page')
      expect(aliceLog).not.toContain('/sessions/a-private-session')
      reportResult('UT-S32-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S32-01', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await fixture.done()
    }
  })

  it('UT-S32-02 delivers an event stream only to its owner among concurrent sessions', async () => {
    const start = Date.now()
    const fixture = await startGateway()
    try {
      const alice = new Browser(fixture.url)
      const bob = new Browser(fixture.url)
      await alice.loginAs('user-a')
      await bob.loginAs('user-b')

      const [aliceEvents, bobEvents] = await Promise.all([alice.get('/events'), bob.get('/events')])
      expect(aliceEvents.body).toContain('events-user-a')
      expect(aliceEvents.body).not.toContain('user-b')
      expect(bobEvents.body).toContain('events-user-b')
      expect(bobEvents.body).not.toContain('user-a')
      reportResult('UT-S32-02', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S32-02', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await fixture.done()
    }
  })

  it('answers 503 with explicit feedback when the fleet is at capacity', async () => {
    const fixture = await startGateway({ maxProcesses: 1 })
    try {
      const alice = new Browser(fixture.url)
      await alice.loginAs('user-a')
      // Alice's ordinary request is what occupies the fleet's single slot.
      expect((await alice.get('/warm')).status).toBe(200)
      const bob = new Browser(fixture.url)
      await bob.loginAs('user-b')
      const page = await bob.get('/')
      expect(page.status).toBe(503)
      expect(page.body).toContain('fleet at capacity')
    } finally {
      await fixture.done()
    }
  })
})

describe('FleetGateway proxying (unit)', () => {
  it('re-exchanges the launch token once when the process restarts with a fresh secret', async () => {
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      expect((await browser.get('/first')).status).toBe(200)
      fixture.registry.fakeProcess('user-a')?.rotateToken()
      const after = await browser.get('/second')
      expect(after.status).toBe(200)
      expect(after.body).toBe('user-a home /second\n')
    } finally {
      await fixture.done()
    }
  })

  it('does not replay a body-carrying method after a rejected jar', async () => {
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      expect((await browser.get('/first')).status).toBe(200)
      fixture.registry.fakeProcess('user-a')?.rotateToken()
      const post = await fetch(`${fixture.url}/submit`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: browser.cookie ?? '' },
        body: 'payload',
      })
      expect(post.status).toBe(502)
      expect(await post.text()).toContain('rejected the gateway session')
    } finally {
      await fixture.done()
    }
  })

  it('never forwards process cookies or hop-by-hop headers outward', async () => {
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      const response = await fetch(`${fixture.url}/profile`, {
        redirect: 'manual',
        headers: { cookie: browser.cookie ?? '', 'set-cookie': 'browser-refresh=1' },
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('user-a profile\n')
      expect(response.headers.get('set-cookie')).toBeNull()
    } finally {
      await fixture.done()
    }
  })

  it('answers 502 when the subject process is unreachable', async () => {
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      expect((await browser.get('/warm')).status).toBe(200)
      await fixture.registry.killProcess('user-a')
      const dead = await browser.get('/')
      expect(dead.status).toBe(502)
      expect(dead.body).toContain('unreachable')
    } finally {
      await fixture.done()
    }
  })

  it('truncates quietly when the process dies mid-response', async () => {
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      expect((await browser.get('/warm')).status).toBe(200)
      const response = await fetch(`${fixture.url}/half-then-die`, { redirect: 'manual', headers: { cookie: browser.cookie ?? '' } })
      expect(response.status).toBe(200)
    } finally {
      await fixture.gateway.dispose()
      await fixture.registry.dispose()
    }
  })

  it('answers 502 when the launch-token exchange fails on every path', async () => {
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      expect((await browser.get('/warm')).status).toBe(200)
      // Invalidate the jar so every request below has to re-exchange.
      fixture.registry.fakeProcess('user-a')?.rotateToken()

      // Stale launch URL: the process rejects the exchange outright.
      fixture.registry.launchUrlOverride = 'http://process.invalid/?token=stale'
      expect((await browser.get('/stale-url')).status).toBe(502)

      // The exchange connection resets before answering.
      fixture.registry.launchUrlOverride = 'http://process.invalid/?token=reset'
      expect((await browser.get('/reset-url')).status).toBe(502)

      // A redirect with no cookie fails the jar exchange.
      fixture.registry.launchUrlOverride = 'http://process.invalid/?token=bare-303'
      expect((await browser.get('/bare-303-url')).status).toBe(502)
      fixture.registry.launchUrlOverride = undefined

      // No observation at all: the gateway cannot even find the token URL.
      fixture.registry.hideProcessInfo = true
      expect((await browser.get('/no-info')).status).toBe(502)
    } finally {
      await fixture.done()
    }
  })
})

describe('FleetGateway upgrades (unit)', () => {
  it('routes protocol upgrades to the owning process and destroys every other upgrade', async () => {
    const fixture = await startGateway()
    try {
      const browser = new Browser(fixture.url)
      await browser.loginAs('user-a')
      await browser.get('/warm')

      const upstream = await upgradeThrough(fixture.url, '/ws', browser.cookie, 'tail-bytes')
      expect(upstream).toContain('upgraded-user-a')
      expect(fixture.registry.fakeProcess('user-a')?.requests).toContain('upgrade /ws')

      // No session: destroyed.
      expect(await upgradeThrough(fixture.url, '/ws', undefined)).toBeUndefined()
      // A session whose subject never completed an ordinary request has no
      // cookie jar yet: destroyed.
      const carol = new Browser(fixture.url)
      await carol.loginAs('user-c')
      expect(await upgradeThrough(fixture.url, '/ws', carol.cookie)).toBeUndefined()
      // Capacity rejection: destroyed.
      const full = await startGateway({ maxProcesses: 1 })
      try {
        const sole = new Browser(full.url)
        await sole.loginAs('user-a')
        await sole.get('/warm')
        const second = new Browser(full.url)
        await second.loginAs('user-b')
        expect(await upgradeThrough(full.url, '/ws', second.cookie)).toBeUndefined()
      } finally {
        await full.done()
      }
      // Dead upstream: the shared abort handler tears both sockets down.
      await fixture.registry.killProcess('user-a')
      expect(await upgradeThrough(fixture.url, '/ws', browser.cookie)).toBeUndefined()
      // A failing fleet registry rejects the upgrade and destroys the socket.
      fixture.registry.throwOnEnsure = true
      expect(await upgradeThrough(fixture.url, '/ws', browser.cookie)).toBeUndefined()
    } finally {
      await fixture.done()
    }
  })
})

/** Raw upgrade request through the gateway; resolves the first bytes or undefined when destroyed. */
async function upgradeThrough(base: string, path: string, cookie: string | undefined, tail?: string): Promise<string | undefined> {
  const url = new URL(base)
  return await new Promise<string | undefined>((resolve) => {
    const socket = connect({ host: url.hostname, port: url.port }, () => {
      // The tail rides in the same write so the server buffers it as upgrade
      // `head` bytes rather than post-upgrade stream data.
      socket.write(`GET ${path} HTTP/1.1\r\nhost: ${url.host}\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-version: 13\r\nset-cookie: upgrade-check=1\r\n${cookie === undefined ? '' : `cookie: ${cookie}\r\n`}\r\n${tail ?? ''}`)
    })
    let data = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      data += chunk
      if (data.includes('upgraded-')) {
        socket.destroy()
        resolve(data)
      }
    })
    socket.on('close', () => {
      if (!data.includes('upgraded-')) resolve(undefined)
    })
    socket.on('error', () => {
      resolve(undefined)
    })
  })
}

describe('ST-S31/S32 fleet gateway scenarios (real child processes)', () => {
  const providerScript = fileURLToPath(new URL('./helpers/oidc-provider.mjs', import.meta.url))
  const processScript = fileURLToPath(new URL('./helpers/fake-dsh-gateway.mjs', import.meta.url))

  interface RealDeployment {
    gatewayUrl: string
    homesDir: string
    dispose: () => Promise<void>
  }

  async function startRealDeployment(): Promise<RealDeployment> {
    const homesDir = tempDir()
    const provider = spawn(process.execPath, [providerScript], { stdio: ['ignore', 'pipe', 'inherit'] })
    childProcesses.push(provider)
    const issuer = await new Promise<string>((resolve, reject) => {
      provider.stdout?.setEncoding('utf8')
      provider.stdout?.on('data', (chunk: string) => {
        const match = /oidc-provider: (http:\S+)/u.exec(chunk)
        if (match !== null) resolve(match[1] ?? '')
      })
      provider.once('exit', (code) => {
        reject(new Error(`provider exited early (${String(code)})`))
      })
    })

    const manager = new FleetManager({
      homesDir,
      dshCommand: [process.execPath, processScript],
      stopTimeoutMs: 5_000,
      portReadyTimeoutMs: 10_000,
    })
    const gateway = new FleetGateway(
      {
        homesDir,
        oidc: { issuer, clientId: 'fleet-gateway-test-client', clientSecret: 'test-secret' },
        sessionSecret: SECRET,
      },
      { fleetManager: manager },
    )
    const { port } = await gateway.start()
    return {
      gatewayUrl: `http://127.0.0.1:${String(port)}`,
      homesDir,
      dispose: async () => {
        await gateway.dispose()
        await manager.dispose()
      },
    }
  }

  it('ST-S31-01 a first login provisions the user process and lands in its own UI', async () => {
    const start = Date.now()
    const deployment = await startRealDeployment()
    try {
      const browser = new Browser(deployment.gatewayUrl)
      await browser.loginAs('user-a', '/sessions/deep-link')
      const page = await browser.get('/')
      expect(page.status).toBe(200)
      expect(page.body).toBe('user-a home /\n')
      expect(existsSync(join(deployment.homesDir, 'user-a'))).toBe(true)
      reportResult('ST-S31-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('ST-S31-01', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await deployment.dispose()
    }
  }, 30_000)

  it('ST-S31-02 a failed exchange leaves no session and provisions nothing', async () => {
    const start = Date.now()
    const deployment = await startRealDeployment()
    try {
      const browser = new Browser(deployment.gatewayUrl)
      const first = await browser.get('/')
      const state = new URL(first.location ?? '').searchParams.get('state')
      const denied = await fetch(`${deployment.gatewayUrl}/auth/callback?state=${state}&code=deny-user-a`, { redirect: 'manual' })
      expect(denied.status).toBe(401)
      expect(denied.headers.get('set-cookie')).toBeNull()
      const after = await browser.get('/')
      expect(after.status).toBe(302)
      expect(existsSync(join(deployment.homesDir, 'user-a'))).toBe(false)
      reportResult('ST-S31-02', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('ST-S31-02', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await deployment.dispose()
    }
  }, 30_000)

  it('ST-S32-01 user B reaching for A URLs lands in B owns process and never reaches A', async () => {
    const start = Date.now()
    const deployment = await startRealDeployment()
    try {
      const alice = new Browser(deployment.gatewayUrl)
      const bob = new Browser(deployment.gatewayUrl)
      await alice.loginAs('user-a')
      await alice.get('/alice-page')
      await bob.loginAs('user-b')

      const intruded = await bob.get('/sessions/a-private-session')
      expect(intruded.status).toBe(200)
      expect(intruded.body).toBe('user-b home /sessions/a-private-session\n')
      expect(intruded.body).not.toContain('user-a home')
      expect(existsSync(join(deployment.homesDir, 'user-a'))).toBe(true)
      expect(existsSync(join(deployment.homesDir, 'user-b'))).toBe(true)
      reportResult('ST-S32-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('ST-S32-01', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await deployment.dispose()
    }
  }, 30_000)

  it('ST-S32-02 concurrent event streams stay mutually exclusive per subject', async () => {
    const start = Date.now()
    const deployment = await startRealDeployment()
    try {
      const alice = new Browser(deployment.gatewayUrl)
      const bob = new Browser(deployment.gatewayUrl)
      await alice.loginAs('user-a')
      await bob.loginAs('user-b')

      const [aliceEvents, bobEvents] = await Promise.all([alice.get('/events'), bob.get('/events')])
      expect(aliceEvents.body).toContain('events-user-a')
      expect(aliceEvents.body).not.toContain('user-b')
      expect(bobEvents.body).toContain('events-user-b')
      expect(bobEvents.body).not.toContain('user-a')
      reportResult('ST-S32-02', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('ST-S32-02', 'fail', String(error), Date.now() - start)
      throw error
    } finally {
      await deployment.dispose()
    }
  }, 30_000)
})

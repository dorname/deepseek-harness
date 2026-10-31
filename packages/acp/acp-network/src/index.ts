/**
 * Network ACP (Agent Client Protocol) transport for DeepSeek Harness.
 *
 * Registers WebSocket and/or Streamable HTTP routes on the Cordis webserver,
 * accepts one ACP client per connection, and drives an isolated
 * {@link @deepseek-ai/dsh-acp#AcpBridge} per connection. The automation-only
 * protocol surface is unchanged; only the transport layer moves from stdio to
 * the network.
 *
 * @module @deepseek-ai/dsh-acp-network
 */

import type { Context } from '@deepseek-ai/cordis'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { AcpServer } from '@agentclientprotocol/sdk/experimental/server'
import { createNodeHttpHandler } from '@agentclientprotocol/sdk/experimental/node'
import type { AuthenticateRequest } from '@agentclientprotocol/sdk'
import { WebSocketServer } from 'ws'
import { AcpBridge, type AcpBridgeOptions } from '@deepseek-ai/dsh-acp'

export { AcpBridge, type AcpBridgeOptions } from '@deepseek-ai/dsh-acp'

/** ACP network transport mode. */
export type AcpNetworkTransport = 'websocket' | 'http' | 'both'

/** Token validation result. */
export interface ValidatedToken {
  /** Subject that must match the instance's DSH_FLEET_USER_ID. */
  subject: string
  /** Unique token id used for replay prevention. */
  jti: string
}

/** Parses and validates an ACP authentication token. */
export type TokenValidator = (token: string) => ValidatedToken | Promise<ValidatedToken>

/** Network ACP plugin configuration. */
export interface AcpNetworkConfig extends AcpBridgeOptions {
  /** Transport mode. @default 'websocket' */
  transport?: AcpNetworkTransport
  /** Absolute path for the ACP route. @default '/acp' */
  path?: string
  /** Shared secret for HMAC-SHA256 token validation. */
  secret?: string
  /** Expected token audience; defaults to env or hostname-based audience. */
  audience?: string
  /** Optional custom token validator; overrides the built-in HMAC validator. */
  validateToken?: TokenValidator
}

/** Public Config schema. */
export const Config: Schema<AcpNetworkConfig> = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  sessionListPageSize: Schema.natural().min(1).default(100),
  transport: Schema.union([
    Schema.const('websocket' as const),
    Schema.const('http' as const),
    Schema.const('both' as const),
  ]).default('websocket'),
  path: Schema.string().default('/acp'),
  secret: Schema.string(),
  audience: Schema.string(),
})

/** Services required by this plugin. */
export const inject = ['webServer', 'agents', 'llm', 'sessionPersistence', 'sessions']

/** Plugin name. */
export const name = 'acp-network'

const DEFAULT_TOKEN_TTL_SECONDS = 300

/**
 * Build an HMAC-SHA256 token validator bound to a shared secret and optional
 * subject audience. The token format is a compact JWT-like `<base64header>.<base64payload>.<base64sig>`
 * where header is `{alg:"HS256",typ:"JWT"}` and payload is `{sub,jti,exp,aud}`.
 * @param secret - Shared HMAC secret the deployer issued the token with.
 * @param expectedAudience - Required `aud` claim; omitted when the deployment has one audience.
 * @returns Validator that throws on malformed, forged, expired, or wrong-audience tokens
 * and returns the accepted `sub`/`jti` claims.
 */
export function createHmacTokenValidator(secret: string, expectedAudience?: string): TokenValidator {
  return (token: string): ValidatedToken => {
    const [headerB64, payloadB64, signatureB64] = token.split('.')
    if (headerB64 === undefined || payloadB64 === undefined || signatureB64 === undefined) {
      throw new Error('acp-network: malformed token')
    }

    const expectedSig = createHmacTokenSignature(secret, `${headerB64}.${payloadB64}`)
    if (!timingSafeEqualsBase64Url(signatureB64, expectedSig)) {
      throw new Error('acp-network: invalid token signature')
    }

    let payload: unknown
    try {
      payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    } catch {
      throw new Error('acp-network: malformed token payload')
    }

    if (
      typeof payload !== 'object'
      || payload === null
      || !('sub' in payload)
      || !('jti' in payload)
      || !('exp' in payload)
      || typeof payload.sub !== 'string'
      || typeof payload.jti !== 'string'
      || typeof payload.exp !== 'number'
    ) {
      throw new Error('acp-network: invalid token claims')
    }

    if (payload.exp * 1000 < Date.now()) {
      throw new Error('acp-network: token expired')
    }

    if (expectedAudience !== undefined) {
      if (!('aud' in payload) || payload.aud !== expectedAudience) {
        throw new Error('acp-network: token audience mismatch')
      }
    }

    return { subject: payload.sub, jti: payload.jti }
  }
}

/**
 * Sign a compact HMAC token for the given subject and audience.
 * @param secret - Shared HMAC secret validators verify against.
 * @param subject - Identity the token authenticates (for example a fleet user id).
 * @param audience - `aud` claim the validator requires.
 * @param ttlSeconds - Lifetime added to the current time for the `exp` claim.
 * @returns The signed `<base64header>.<base64payload>.<base64sig>` token string.
 */
export function signHmacToken(secret: string, subject: string, audience: string, ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    sub: subject,
    jti: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    aud: audience,
  }))
  const signature = createHmacTokenSignature(secret, `${header}.${payload}`)
  return `${header}.${payload}.${signature}`
}

function createHmacTokenSignature(secret: string, message: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(message).digest())
}

function base64UrlEncode(input: string | Uint8Array): string {
  const base64 = typeof input === 'string'
    ? Buffer.from(input, 'utf8').toString('base64')
    : Buffer.from(input).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function timingSafeEqualsBase64Url(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  return leftBuf.length === rightBuf.length && timingSafeEqual(leftBuf, rightBuf)
}

/** Mount the network ACP transport on the Cordis webserver. */
export function apply(ctx: Context, config: AcpNetworkConfig): void {
  const resolved = {
    transport: config.transport ?? 'websocket',
    path: config.path ?? '/acp',
    ...config,
  }

  const audience = config.audience ?? process.env.DSH_ACP_NETWORK_AUDIENCE ?? process.env.HOSTNAME ?? 'dsh-acp'
  const expectedSubject = process.env.DSH_FLEET_USER_ID

  const validator: TokenValidator | undefined = config.validateToken
    ?? (config.secret !== undefined ? createHmacTokenValidator(config.secret, audience) : undefined)

  const usedJtis = new Set<string>()

  const authenticate = async (params: AuthenticateRequest): Promise<void> => {
    if (validator === undefined) return
    const meta = params._meta as Record<string, unknown> | undefined
    const token = typeof meta?.token === 'string' ? meta.token : undefined
    if (token === undefined) throw new Error('acp-network: authentication token required')
    const validated = await validator(token)
    if (usedJtis.has(validated.jti)) throw new Error('acp-network: token reused')
    usedJtis.add(validated.jti)
    if (expectedSubject !== undefined && validated.subject !== expectedSubject) {
      throw new Error('acp-network: token subject mismatch')
    }
  }

  const createAgent = (): AcpBridge => new AcpBridge(ctx, {
    ...config,
    authenticate,
  })

  const acpServer = new AcpServer({ createAgent })

  const logger = ctx.logger
  const disposers: Array<() => void> = []

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/healthz',
    handler: (_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/plain')
      res.end('ok')
    },
  }))

  if (resolved.transport === 'websocket' || resolved.transport === 'both') {
    const wsServer = new WebSocketServer({ noServer: true })

    const route: WebUpgradeRoute = {
      path: resolved.path,
      handler: (req, socket, head) => {
        let upgrade: ReturnType<AcpServer['prepareWebSocketUpgrade']> | undefined
        const onHeaders = (headers: string[]): void => {
          if (upgrade === undefined) return
          headers.push(`Acp-Connection-Id: ${upgrade.connectionId}`)
        }
        const cleanup = (): void => {
          wsServer.off('headers', onHeaders)
        }
        try {
          upgrade = acpServer.prepareWebSocketUpgrade()
          wsServer.on('headers', onHeaders)
          wsServer.handleUpgrade(req, socket, head, (webSocket) => {
            cleanup()
            upgrade?.accept(webSocket)
          })
        } catch (error) {
          cleanup()
          upgrade?.reject()
          logger.warn(`acp-network: WebSocket upgrade failed: ${String(error)}`)
          socket.destroy()
        }
      },
    }
    disposers.push(ctx.webServer.registerUpgrade(route))
  }

  if (resolved.transport === 'http' || resolved.transport === 'both') {
    const httpHandler = createNodeHttpHandler(acpServer)
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: resolved.path,
      handler: (req, res) => {
        httpHandler(req, res)
      },
    }))
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
    void acpServer.close()
  }, 'acp-network.routes')
}

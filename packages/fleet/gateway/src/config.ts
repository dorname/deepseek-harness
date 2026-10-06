/**
 * Gateway configuration: deployment-varying settings with fail-loud
 * validation at load. Protocol constants (cookie name, state lifetime)
 * stay fixed; anything a self-hosted deployment must tune is here.
 *
 * @module
 */

import { randomBytes } from 'node:crypto'

/** OIDC provider binding for the authorization-code flow. */
export interface GatewayOidcConfig {
  /** Discovery root of the identity provider, e.g. `https://idp.example`. */
  issuer: string
  /** OAuth client id registered at the provider. */
  clientId: string
  /** OAuth client secret registered at the provider. */
  clientSecret: string
}

/** Full gateway configuration before validation. */
export interface GatewayConfig {
  /** Fleet homes root; the gateway-owned fleet manager provisions `<homesDir>/<subject>`. */
  homesDir: string
  /** Bind host; loopback by default — a public deployment must opt in explicitly. */
  host: string
  /** Listen port; `0` lets the OS assign one. */
  port: number
  /**
   * Canonical external root browsers use, e.g. `https://dsh.example`. Builds
   * the OIDC `redirect_uri` and the post-login redirect target. Defaults to
   * the bound loopback address.
   */
  publicUrl?: string
  /** Gateway session lifetime in milliseconds. */
  sessionTtlMs: number
  /**
   * Base64url session-cookie signing secret (32 bytes). Absent: generated
   * per process, so gateway sessions do not survive a restart — deployments
   * that need sticky sessions configure this explicitly.
   */
  sessionSecret?: string
  /** OIDC provider binding. */
  oidc: GatewayOidcConfig
}

/** Validated gateway configuration; construct through {@link resolveGatewayConfig}. */
export interface ResolvedGatewayConfig extends GatewayConfig {
  host: string
  port: number
  sessionTtlMs: number
  sessionSecret: string
  publicUrl: string
}

/** One day, the longest lifetime a login flow reasonably needs. */
const STATE_TTL_LIMIT_MS = 24 * 60 * 60 * 1000

const BASE64URL_32_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * Validate gateway configuration, applying defaults. Misconfiguration fails
 * loud at load: a gateway that cannot state its issuer or homes root has no
 * safe behavior to fall back to.
 * @param config - deployment-provided values; every field is checked.
 * @returns the resolved configuration with defaults applied.
 * @throws naming the first invalid field.
 */
export function resolveGatewayConfig(config: Partial<GatewayConfig>): ResolvedGatewayConfig {
  if (config.homesDir === undefined || config.homesDir === '') throw new Error('gateway: homesDir is required')
  const host = config.host ?? '127.0.0.1'
  const port = config.port ?? 0
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('gateway: port must be 0-65535')
  const sessionTtlMs = config.sessionTtlMs ?? 12 * 60 * 60 * 1000
  if (!Number.isInteger(sessionTtlMs) || sessionTtlMs <= 0 || sessionTtlMs > STATE_TTL_LIMIT_MS * 30) {
    throw new Error('gateway: sessionTtlMs must be a positive millisecond duration')
  }
  const sessionSecret = config.sessionSecret ?? generateSessionSecret()
  if (!BASE64URL_32_PATTERN.test(sessionSecret)) {
    throw new Error('gateway: sessionSecret must be 32 bytes of base64url (43 characters)')
  }
  const oidc = config.oidc
  if (oidc === undefined) throw new Error('gateway: oidc is required')
  let issuerHost: string
  try {
    issuerHost = new URL(oidc.issuer).host
  } catch {
    throw new Error('gateway: oidc.issuer must be an absolute URL')
  }
  if (issuerHost === '') throw new Error('gateway: oidc.issuer must be an absolute URL')
  if (oidc.clientId === '') throw new Error('gateway: oidc.clientId is required')
  if (oidc.clientSecret === '') throw new Error('gateway: oidc.clientSecret is required')
  const publicUrl = config.publicUrl ?? `http://${host}${port === 0 ? '' : `:${String(port)}`}`
  try {
    new URL(publicUrl)
  } catch {
    throw new Error('gateway: publicUrl must be an absolute URL')
  }
  return { ...config, host, port, sessionTtlMs, sessionSecret, publicUrl } as ResolvedGatewayConfig
}

function generateSessionSecret(): string {
  // 32 random bytes, base64url: exactly the shape the validation accepts.
  return Buffer.from(randomBytes(32)).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

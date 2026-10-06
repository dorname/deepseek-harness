/**
 * Gateway browser sessions: a signed, HttpOnly cookie binding the browser to
 * the authenticated fleet subject. The browser holds nothing else — process
 * launch tokens never leave the loopback.
 *
 * @module
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** The fixed gateway session cookie name. */
export const GATEWAY_COOKIE_NAME = 'dsh-fleet-gateway'

/** A verified gateway session: the subject the browser authenticated as. */
export interface GatewaySession {
  subject: string
}

interface SessionPayload {
  readonly subject: string
  readonly issuedAt: number
  readonly expiresAt: number
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
export function cookieValue(headerValue: string | undefined, name: string): string | undefined {
  if (headerValue === undefined) return undefined
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed session cookie attributes; the name and value are cookie-safe. */
export function sessionCookie(value: string, expiresAt: number, maxAgeSeconds: number): string {
  return `${GATEWAY_COOKIE_NAME}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Lax`
}

/**
 * Issues and verifies gateway session cookies. Values are versioned,
 * base64url payloads bound to an expiry, signed with the deployment secret;
 * a tampered, foreign-keyed, or expired cookie verifies to nothing.
 */
export class GatewaySessions {
  private readonly secret: Buffer
  private readonly ttlMilliseconds: number
  private readonly now: () => number

  /**
   * @param secretBase64Url - 32-byte base64url signing secret (see {@link resolveGatewayConfig}).
   * @param ttlMilliseconds - session lifetime in milliseconds.
   * @param now - clock seam (test hook).
   */
  constructor(secretBase64Url: string, ttlMilliseconds: number, now: () => number = Date.now) {
    this.secret = Buffer.from(secretBase64Url, 'base64')
    this.ttlMilliseconds = ttlMilliseconds
    this.now = now
  }

  /**
   * Mint one session for a just-authenticated subject.
   * @param subject - the authenticated fleet subject.
   * @returns the cookie value plus absolute expiry for the Set-Cookie header.
   */
  issue(subject: string): { value: string; expiresAt: number } {
    const issuedAt = this.now()
    const expiresAt = issuedAt + this.ttlMilliseconds
    const payload: SessionPayload = { subject, issuedAt, expiresAt }
    const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
    return { value: `v1.${body}.${encodeBase64Url(signature(this.secret, body))}`, expiresAt }
  }

  /**
   * Verify a cookie value from the request.
   * @param cookieHeader - the request's Cookie header, verbatim.
   * @returns the session when the cookie is intact and unexpired, else `undefined`.
   */
  verify(cookieHeader: string | undefined): GatewaySession | undefined {
    const raw = cookieValue(cookieHeader, GATEWAY_COOKIE_NAME)
    if (raw === undefined) return undefined
    const parts = raw.split('.')
    const [version, body, encodedSignature] = parts
    if (parts.length !== 3 || version !== 'v1' || body === undefined || encodedSignature === undefined) return undefined
    const actual = decodeBase64Url(encodedSignature)
    if (actual === undefined) return undefined
    const expected = signature(this.secret, body)
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return undefined
    let decoded: unknown
    try {
      const bytes = decodeBase64Url(body)
      if (bytes === undefined) return undefined
      decoded = JSON.parse(bytes.toString('utf8'))
    } catch {
      return undefined
    }
    if (typeof decoded !== 'object' || decoded === null) return undefined
    const payload = decoded as Partial<SessionPayload>
    const { subject, issuedAt, expiresAt } = payload
    if (typeof subject !== 'string' || subject === ''
      || typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt)
      || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) return undefined
    const now = this.now()
    return issuedAt <= now && expiresAt > now
      && expiresAt - issuedAt <= this.ttlMilliseconds
      ? { subject }
      : undefined
  }
}

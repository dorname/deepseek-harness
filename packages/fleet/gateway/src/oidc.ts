/**
 * Minimal OIDC authorization-code client for the gateway login flow:
 * discovery, the authorization redirect, and the code-to-identity exchange.
 *
 * The exchange authenticates through the token endpoint over the issuer's
 * TLS plus the client secret, so per OIDC Core 3.1.3.7 the ID token's
 * signature MAY be validated by that direct TLS channel; this client checks
 * the token's issuer, audience, and expiry claims and takes the `sub`.
 *
 * @module
 */

/** Endpoints discovery yields; everything the code flow needs. */
export interface OidcEndpoints {
  /** Provider authorization endpoint (the login page lives there). */
  authorizationEndpoint: string
  /** Provider token endpoint (code-to-token exchange). */
  tokenEndpoint: string
}

/** Injectable fetch seam; production passes global `fetch`. */
export interface FetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

/** Injectable fetch seam; production passes global `fetch`. */
export type FetchLike = (
  input: string,
  init?: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>

/**
 * Discover the provider's endpoints from its well-known configuration.
 * @param issuer - discovery root, e.g. `https://idp.example`.
 * @param fetchImpl - HTTP seam (test hook).
 * @returns the authorization and token endpoints.
 * @throws when discovery fails or the document lacks the code-flow endpoints.
 */
export async function discoverOidc(issuer: string, fetchImpl: FetchLike = fetch): Promise<OidcEndpoints> {
  const url = `${issuer.replace(/\/+$/u, '')}/.well-known/openid-configuration`
  const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`gateway: OIDC discovery at ${url} failed with status ${String(response.status)}`)
  }
  const document = await response.json() as { authorization_endpoint?: unknown; token_endpoint?: unknown }
  if (typeof document.authorization_endpoint !== 'string' || typeof document.token_endpoint !== 'string') {
    throw new Error(`gateway: OIDC discovery at ${url} does not describe the authorization-code flow`)
  }
  return { authorizationEndpoint: document.authorization_endpoint, tokenEndpoint: document.token_endpoint }
}

/**
 * Build the provider authorization redirect for one login attempt.
 * @param endpoints - discovered provider endpoints.
 * @param request - client binding, redirect target, and the CSRF state.
 * @returns the absolute URL to redirect the browser to.
 */
export function buildAuthorizationUrl(
  endpoints: OidcEndpoints,
  request: { clientId: string; redirectUri: string; state: string },
): string {
  const url = new URL(endpoints.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid')
  url.searchParams.set('client_id', request.clientId)
  url.searchParams.set('redirect_uri', request.redirectUri)
  url.searchParams.set('state', request.state)
  return url.href
}

/** Claims the gateway relies on inside the ID token payload. */
interface IdTokenClaims {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  sub?: unknown
}

/**
 * Extract the authenticated subject from an ID token, checking the claims
 * the direct token-endpoint channel does not already guarantee.
 * @param idToken - the compact JWS string from the token endpoint.
 * @param expected - issuer and client binding discovered for this gateway.
 * @param nowSeconds - current time in seconds (test seam).
 * @returns the `sub` claim.
 * @throws when the token is malformed or any checked claim mismatches.
 */
export function extractSubject(
  idToken: string,
  expected: { issuer: string; clientId: string },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const parts = idToken.split('.')
  const [, payloadSegment] = parts
  if (parts.length !== 3 || payloadSegment === undefined) throw new Error('gateway: token endpoint returned a malformed ID token')
  const payload = decodeBase64UrlJson(payloadSegment)
  if (payload === undefined) throw new Error('gateway: ID token payload is not valid base64url JSON')
  if (payload.iss !== expected.issuer) {
    throw new Error(`gateway: ID token issuer ${JSON.stringify(String(payload.iss))} does not match the configured issuer`)
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(expected.clientId)) {
    throw new Error('gateway: ID token audience does not include this client')
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    throw new Error('gateway: ID token is expired or has no expiry')
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('gateway: ID token carries no subject')
  }
  return payload.sub
}

/**
 * Exchange one authorization code for the authenticated subject.
 * @param endpoints - discovered provider endpoints.
 * @param request - client binding, the one-time code, and redirect echo.
 * @param fetchImpl - HTTP seam (test hook).
 * @returns the authenticated subject (`sub`).
 * @throws when the exchange fails, the response is malformed, or a claim mismatches.
 */
export async function exchangeCodeForSubject(
  endpoints: OidcEndpoints,
  request: { issuer: string; clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: request.code,
    redirect_uri: request.redirectUri,
    client_id: request.clientId,
    client_secret: request.clientSecret,
  })
  const response = await fetchImpl(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  if (!response.ok) {
    throw new Error(`gateway: token exchange at ${endpoints.tokenEndpoint} failed with status ${String(response.status)}`)
  }
  const document = await response.json() as { id_token?: unknown }
  if (typeof document.id_token !== 'string') {
    throw new Error(`gateway: token exchange at ${endpoints.tokenEndpoint} returned no ID token`)
  }
  return extractSubject(document.id_token, { issuer: request.issuer, clientId: request.clientId })
}

function decodeBase64UrlJson(segment: string): IdTokenClaims | undefined {
  try {
    const json = Buffer.from(segment.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

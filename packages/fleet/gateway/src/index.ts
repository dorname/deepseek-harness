/**
 * @deepseek-ai/dsh-gateway — the OIDC-authenticated reverse proxy of a User
 * Fleet deployment. Exported for deployment tooling and tests; the gateway
 * is not a Cordis plugin.
 * @module @deepseek-ai/dsh-gateway
 */

export { resolveGatewayConfig } from './config.ts'
export type { GatewayConfig, GatewayOidcConfig, ResolvedGatewayConfig } from './config.ts'
export { buildAuthorizationUrl, discoverOidc, exchangeCodeForSubject, extractSubject } from './oidc.ts'
export type { FetchLike, OidcEndpoints } from './oidc.ts'
export { GATEWAY_COOKIE_NAME, GatewaySessions, cookieValue, sessionCookie } from './session.ts'
export { FleetGateway } from './gateway.ts'
export type { FleetGatewayOptions } from './gateway.ts'

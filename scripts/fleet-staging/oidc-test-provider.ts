/**
 * In-process OIDC test provider for the local staging deployment. Serves
 * discovery, authorize, and token endpoints; the subject travels inside the
 * one-time code (`code-<subject>`), so a runner decides who "logs in". An
 * authorization request with `login_as=deny-…` answers the OAuth
 * `error=access_denied` redirect instead, the way a user rejecting consent
 * behaves. The minted ID tokens are unsigned, but the gateway's
 * direct-channel claim checks (iss/aud/exp) still validate against this
 * provider — the same trust model as the gateway suites.
 *
 * @module
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/** One running test provider. */
export interface OidcTestProvider {
  /** Issuer root URLs are built from, e.g. `http://127.0.0.1:PORT`. */
  issuer: string
  /** Stop listening and wait for the close. */
  close(): Promise<void>
}

function mintIdToken(issuer: string, clientId: string, subject: string): string {
  const payload = {
    iss: issuer,
    aud: clientId,
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 300,
  }
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

/** The authorize request is decided by `login_as`; denial answers the OAuth error redirect. */
function answerAuthorize(url: URL, respond: (status: number, headers: Record<string, string>) => void): void {
  const redirectUri = url.searchParams.get('redirect_uri') ?? '/'
  const state = url.searchParams.get('state') ?? ''
  const loginAs = url.searchParams.get('login_as') ?? 'staging-user'
  if (loginAs.startsWith('deny-')) {
    respond(302, { location: `${redirectUri}?error=access_denied&state=${encodeURIComponent(state)}` })
    return
  }
  respond(302, {
    location: `${redirectUri}?code=code-${encodeURIComponent(loginAs)}&state=${encodeURIComponent(state)}`,
  })
}

/**
 * Start the loopback test provider.
 * @param oidc - the client binding the gateway presents; discovery reports
 * them back so the gateway's claim checks pass.
 * @returns the running provider with its issuer root.
 */
export async function startOidcTestProvider(oidc: { clientId: string; clientSecret: string }): Promise<OidcTestProvider> {
  let issuer = 'http://127.0.0.1:0'
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', issuer)
    if (url.pathname === '/.well-known/openid-configuration') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
      }))
      return
    }
    if (url.pathname === '/authorize') {
      answerAuthorize(url, (status, headers) => {
        response.writeHead(status, headers)
        response.end()
      })
      return
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      let body = ''
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        const code = new URLSearchParams(body).get('code') ?? ''
        if (!code.startsWith('code-')) {
          response.writeHead(401, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'invalid_grant' }))
          return
        }
        const subject = decodeURIComponent(code.slice('code-'.length))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          access_token: `at-${subject}`,
          id_token: mintIdToken(issuer, oidc.clientId, subject),
        }))
      })
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('fleet-staging: OIDC test provider failed to bind a loopback port')
  }
  issuer = `http://127.0.0.1:${String(address.port)}`
  return {
    issuer,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error !== undefined) rejectClose(error)
        else resolveClose()
      })
    }),
  }
}

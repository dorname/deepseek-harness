// Minimal OIDC test provider for the gateway suites: discovery, authorize
// redirect, and a token endpoint that mints unsigned ID tokens whose claims
// the gateway's direct-channel checks (iss/aud/exp) still validate. The
// subject travels inside the one-time code (`code-<subject>`), so a test
// decides who "logs in". A code of `deny-...` makes the exchange fail, the
// way a rejected or broken login does. Prints the bound issuer URL on
// `oidc-provider: <url>`.
import { createServer } from 'node:http'

let issuerBase = 'http://127.0.0.1:0'

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', issuerBase)
  if (url.pathname === '/.well-known/openid-configuration') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      issuer: issuerBase,
      authorization_endpoint: `${issuerBase}/authorize`,
      token_endpoint: `${issuerBase}/token`,
    }))
    return
  }
  if (url.pathname === '/authorize') {
    const state = url.searchParams.get('state') ?? ''
    const subject = url.searchParams.get('login_as') ?? 'user-a'
    response.writeHead(302, {
      location: `${url.searchParams.get('redirect_uri') ?? '/'}?code=code-${encodeURIComponent(subject)}&state=${encodeURIComponent(state)}`,
    })
    response.end()
    return
  }
  if (url.pathname === '/token' && request.method === 'POST') {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const form = new URLSearchParams(body)
      const code = form.get('code') ?? ''
      if (code.startsWith('deny-')) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }
      const subject = code.startsWith('code-') ? decodeURIComponent(code.slice('code-'.length)) : 'user-a'
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id_token: mintIdToken(subject) }))
    })
    return
  }
  response.writeHead(404)
  response.end()
})

function mintIdToken(subject) {
  const payload = {
    iss: issuerBase,
    aud: 'fleet-gateway-test-client',
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 300,
  }
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

server.listen(0, '127.0.0.1', () => {
  issuerBase = `http://127.0.0.1:${String(server.address().port)}`
  process.stdout.write(`oidc-provider: ${issuerBase}\n`)
})

process.on('SIGTERM', () => {
  process.exit(0)
})

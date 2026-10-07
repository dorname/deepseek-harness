/**
 * Browser-shaped helpers for driving the staging gateway: a per-agent cookie
 * jar plus the full OIDC authorization-code login performed with manual
 * redirect following. The test provider decides the identity through the
 * `login_as` authorize parameter; `deny-…` subjects exercise the rejection
 * path (the provider answers the OAuth `error=access_denied` redirect).
 *
 * @module
 */

/** Cookie jar of one browser identity: name → cookie value. */
export class CookieJar {
  private readonly cookies = new Map<string, string>()

  /** Store every `set-cookie` pair a response carries. */
  absorb(response: Response): void {
    const raw = response.headers.getSetCookie()
    for (const cookie of raw) {
      const [pair] = cookie.split(';')
      if (pair === undefined) continue
      const equals = pair.indexOf('=')
      if (equals <= 0) continue
      this.cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim())
    }
  }

  /** `Cookie` header value, or undefined with an empty jar. */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

/**
 * Follow one URL with manual redirects, absorbing cookies on every hop.
 * @param jar - the browser identity performing the request.
 * @param url - absolute URL to open.
 * @returns the first non-redirect response; callers read status/headers.
 */
export async function browserGet(jar: CookieJar, url: string): Promise<Response> {
  let next = url
  for (let hops = 0; hops < 10; hops += 1) {
    const response = await fetch(next, { redirect: 'manual', headers: jar.header() === undefined ? {} : { cookie: jar.header() ?? '' } })
    jar.absorb(response)
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (location === null) return response
    next = new URL(location, next).href
  }
  throw new Error(`fleet-staging: login redirect chain exceeded 10 hops at ${next}`)
}

/**
 * Complete an OIDC login against the staging gateway as one subject.
 * @param gatewayUrl - gateway root.
 * @param subject - identity the test provider should assert; a `deny-…`
 * subject makes the provider refuse authorization.
 * @returns the jar holding the gateway session and the final response.
 */
export async function loginThroughGateway(gatewayUrl: string, subject: string): Promise<{ jar: CookieJar; response: Response }> {
  const jar = new CookieJar()
  const entry = await fetch(new URL('/', gatewayUrl), { redirect: 'manual' })
  const authorizeUrl = entry.headers.get('location')
  if (entry.status !== 302 || authorizeUrl === null) {
    throw new Error(`fleet-staging: expected the gateway to redirect to the provider, got ${String(entry.status)}`)
  }
  const withSubject = new URL(authorizeUrl)
  withSubject.searchParams.set('login_as', subject)
  const response = await browserGet(jar, withSubject.href)
  return { jar, response }
}

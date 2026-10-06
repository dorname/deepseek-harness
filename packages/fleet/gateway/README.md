---
description: "OIDC-authenticated reverse proxy for User Fleet deployments: one gateway session per browser, strict per-subject routing to the owning user's process, and launch tokens that never leave the loopback."
kind: "package-library"
---

# @deepseek-ai/dsh-gateway

English | [中文](README.zh.md)

## Summary

The gateway is the single authenticated entry point of a User Fleet deployment. Browsers authenticate through an OIDC authorization-code flow hosted by the identity provider; the gateway answers the callback by exchanging the code for the authenticated subject and binding the browser to it with a signed, HttpOnly session cookie. Every subsequent request — ordinary HTTP, server-sent events, and protocol upgrades — routes strictly by that cookie's subject into the subject's own process loopback port. There is no code path that routes a session to another subject's process. The user processes' launch-token URLs are consumed once on the loopback (the gateway exchanges each for a browser-session cookie it keeps in a per-subject jar); they are never forwarded outward, and neither are the processes' own cookies. The fleet manager owns the processes; the gateway only asks it to ensure and observe them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Run one gateway in front of the fleet manager. Point `homesDir` at the same homes root the manager uses, and configure the identity provider binding:

| Field | Meaning | Default |
|---|---|---|
| `homesDir` | Fleet homes root (must match the fleet manager's) | required |
| `oidc` | `{ issuer, clientId, clientSecret }` registered at the provider | required |
| `host` / `port` | Bind address; port `0` lets the OS assign one | loopback / `0` |
| `publicUrl` | Canonical external root browsers use; builds the OIDC `redirect_uri` | bound address |
| `sessionTtlMs` | Gateway session lifetime | 12 h |
| `sessionSecret` | 32-byte base64url cookie-signing secret | generated per process |

```ts
import { FleetGateway } from '@deepseek-ai/dsh-gateway'

const gateway = new FleetGateway(
  { homesDir: '/data/homes', oidc: { issuer: 'https://idp.example', clientId: '...', clientSecret: '...' } },
  { fleetManager },
)
const { port } = await gateway.start()
await gateway.dispose()
```

Misconfiguration fails loud at resolve: a missing homes root, issuer, client binding, or a malformed secret refuses to start. With an OS-assigned port and no explicit `publicUrl`, the redirect target is re-pinned to the bound port so the provider's callback reaches this gateway. A login attempt older than ten minutes is discarded through its CSRF state; a rejected or broken exchange answers 401 with an explicit reason and opens no session. When the fleet manager reports the deployment at capacity, browsers get a 503 instead of a queue.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design notes

- **Routing is subject-bound end to end.** `handle` verifies the gateway session, asks the manager to ensure that subject's process, and proxies to the port the manager reports. The subject never travels through URL paths or query parameters, so a URL referencing another user's session id still lands in the requesting user's own process.
- **The cookie jar stays on the loopback.** Each process announces a launch-token URL; the gateway GETs it on `127.0.0.1`, banks the minted browser-session cookie per subject, and replays it on proxied requests. A process that rejects the jar (restart with a fresh secret) triggers one re-exchange — for GET/HEAD only, whose replay cannot corrupt an uploaded body.
- **Response filtering.** Proxied responses drop `Set-Cookie` and hop-by-hop headers, so the process's internal cookies and the gateway's session cookie never mix.
- **Upgrades ride the same fence.** WebSocket handshakes require a gateway session plus a banked jar, forward `Upgrade`/`Connection` verbatim (they are the handshake), rewrite `Host`/cookie/forwarded headers, and pipe the raw sockets. Everything else — no session, no jar, capacity rejection, dead upstream — is destroyed.
- **Discovery and exchange behind a seam.** OIDC discovery, the authorization redirect, and the code-to-subject exchange run through an injected `fetch`, and the ID token's issuer, audience, and expiry claims are checked; the signature itself is validated by the direct TLS channel to the token endpoint (OIDC Core 3.1.3.7).

| File | Role |
|---|---|
| [`src/config.ts`](src/config.ts) | Deployment fields, defaults, and fail-loud validation |
| [`src/oidc.ts`](src/oidc.ts) | Discovery, authorization redirect, code-to-subject exchange |
| [`src/session.ts`](src/session.ts) | Signed, expiring gateway session cookies |
| [`src/gateway.ts`](src/gateway.ts) | HTTP server: login flow, per-subject proxy, launch-token jar, upgrade routing |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None. The gateway proxies the user processes' existing web surfaces; once routed, a session behaves exactly as it would against its own single-user process.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Minimal OIDC client.** The flow implements the authorization-code grant with direct token-endpoint claim checks, not a general OIDC relying party: no JWKS signature validation, no refresh tokens, no back-channel logout.
- **Single host, single gateway process.** Generated session secrets keep gateway sessions from surviving a restart; deployments that need sticky sessions configure `sessionSecret` explicitly.
- **TLS terminates upstream.** The gateway speaks plain HTTP and is meant to sit behind the deployment's TLS terminator; `publicUrl` must be the externally visible root.
- **Local trust model.** The loopback between gateway and user processes is trusted by construction; an administrative user of the host can reach every process directly.
- **Windows untested.** The suite spawns real child processes and is excluded from the Windows lanes together with the fleet manager.

---
description: "Network ACP (Agent Client Protocol) transport for DeepSeek Harness: exposes ACP over WebSocket and Streamable HTTP on the Cordis webserver."
kind: "package-reference"
---

# @deepseek-ai/dsh-acp-network

English | [中文](README.zh.md)

## Summary

`dsh-acp-network` mounts the automation-only ACP server on the Cordis webserver so trusted clients can connect over WebSocket or Streamable HTTP instead of stdio. Each accepted connection gets an isolated {@link @deepseek-ai/dsh-acp#AcpBridge} and can create, prompt, and close its own sessions. Authentication is provided by a configurable HMAC-token validator that checks audience, subject, expiration, and single-use `jti` claims. Run `pnpm dsh --profile acp-network` to start the network server.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when an ACP client reaches the harness over the network, for example a per-user Pod in a multi-user deployment or a remote automation controller.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-acp-network'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    transport: websocket
    path: /acp
    secret: '{{env.DSH_ACP_NETWORK_SECRET}}'
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | — | Provider route for every session's agent |
| `model` | — | Model for every session's agent |
| `transport` | `websocket` | `websocket`, `http`, or `both` |
| `path` | `/acp` | Absolute route for the ACP endpoint |
| `secret` | — | Shared secret for HMAC token validation |
| `audience` | `DSH_ACP_NETWORK_AUDIENCE` / `HOSTNAME` / `dsh-acp` | Expected token audience (`aud`) |
| `sessionListPageSize` | `100` | Maximum summaries returned in one `session/list` page |

### Token format

Clients authenticate with a compact JWT-like HMAC token signed by the shared secret:

```
<base64url-header>.<base64url-payload>.<base64url-signature>
```

- Header: `{ alg: "HS256", typ: "JWT" }`
- Payload: `{ sub, jti, exp, aud }`
  - `sub` must match `DSH_FLEET_USER_ID`
  - `aud` must match the configured `audience` (default `dsh-acp`)
  - `jti` must be unique within the token lifetime
  - `exp` is a Unix seconds expiration, recommended ≤ 300

### Run the local smoke

```sh
pnpm -F @deepseek-ai/dsh-acp-network smoke
```

This boots an in-process server with a mocked LLM and verifies the WebSocket handshake, token authentication, prompt loop, and resume-after-reconnect flow.

### Start a server

`pnpm dsh --profile acp-network` starts the shipped network ACP server. TLS should be terminated by the ingress or a sidecar; the process-bound webserver listens on loopback by default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: token validator, WebSocket upgrade and HTTP route registration, per-connection `AcpBridge` |

The plugin uses `@agentclientprotocol/sdk/experimental/server` (`AcpServer`) for transport framing. The WebSocket path calls `AcpServer.prepareWebSocketUpgrade()` before the HTTP upgrade so the `Acp-Connection-Id` header can be attached. The HTTP path uses `createNodeHttpHandler`. Each accepted connection receives a fresh `AcpBridge` with an injected `authenticate` hook.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only transports ACP frames and authentication metadata without contributing model context.

#### KV Cache effect

None; the transport is stateless with respect to the model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Connection-bound sessions** — each `AcpBridge` owns its sessions; when a connection closes, its sessions are closed. Resume after disconnect requires the session to have been explicitly closed and persisted, then restored with `session/resume`. A future server-level shared session registry could keep sessions alive across reconnections.
- **In-memory token replay store** — used `jti` values live only for the process lifetime; token lifetime bounds the replay window.
- **TLS termination is external** — the plugin serves plain WebSocket/HTTP; encrypt at the ingress, load balancer, or sidecar.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

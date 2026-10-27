---
description: "dsh ACP-over-network profile bundle: starts a network ACP server via `dsh --profile acp-network`."
kind: "package-bundle"
---

# @deepseek-ai/dsh-acp-network-app

English | [中文](README.zh.md)

## Summary

`dsh-acp-network-app` is the runnable profile bundle that starts an ACP-over-network server with `dsh --profile acp-network`. It layers the network ACP transport on top of `dsh-base` and the Cordis webserver. Use it when a remote or Pod-resident client needs to drive DeepSeek Harness agents over WebSocket or Streamable HTTP.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

`pnpm dsh --profile acp-network` boots the server. Configure the transport through the `acp-network` plugin in the profile's `cordis.patch.yml` or via environment variables:

| Variable | Meaning |
|---|---|
| `DSH_ACP_NETWORK_SECRET` | Shared secret used to validate HMAC tokens |
| `DSH_FLEET_USER_ID` | Expected token subject (`sub`) |
| `DSH_ACP_NETWORK_AUDIENCE` | Expected token audience (`aud`), default `dsh-acp` |

-----

<a id="model-experience"></a>
## Model Experience

None, as this bundle only mounts the network transport and delegates every model-facing effect to the underlying ACP bridge.

#### KV Cache effect

None; the ACP bridge owns every model-facing byte.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Connection-bound sessions** — sessions are owned by the per-connection `AcpBridge`; disconnect closes them. Resume after reconnect requires an explicit `session/close` and `session/resume`.
- **In-memory replay store** — used `jti` values are tracked only in process memory.
- **No built-in TLS** — terminate TLS at the ingress or sidecar.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

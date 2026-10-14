---
description: "Service Definition: cross-node relay of one session's events and assistant-stream frames by monotonic sequence."
kind: "package-reference"
---

# @deepseek-ai/dsh-stream-relay

English | [中文](README.zh.md)

## Summary

Publish existing session events and assistant-stream frames for other replicas to replay. Each session has increasing sequence numbers; subscribers replay after a cursor before receiving new records. Mount a provider such as `stream-relay-postgres` to supply the shared transport. The relay adds no model input.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Consumers use `ctx.streamRelay`. Mount the [PostgreSQL provider](../stream-relay-postgres/README.md) to register a concrete implementation; this abstract service alone supplies no database connection.

### Observable behavior

`publish` assigns the next session sequence number. `read` returns records strictly after a cursor; `subscribe` replays existing records before live delivery and accepts cancellation. Payloads remain unchanged.

-----

<a id="model-experience"></a>
## Model Experience

### Cross-node session execution

#### What the model sees

Nothing directly. `ctx.streamRelay` coordinates host-side session work without adding prompts, tools, or schemas.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the package never touches live request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A provider is required** — this package declares the service and has no storage implementation.
- **No retention API** — cleanup belongs to the provider or deployment.
- **Host-side coordination only** — callers own session execution, durable logging, and browser delivery.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

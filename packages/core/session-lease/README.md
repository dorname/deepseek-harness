---
description: "Service Definition: the cross-node single-writer claim for one session — acquire/renew/release/ownerOf/waitLost."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-lease

English | [中文](README.zh.md)

## Summary

Coordinate one session writer across runner nodes through atomic lease acquisition, renewal, and release. Consumers observe lease loss and cancel work when ownership expires. Mount a provider such as `session-lease-postgres` to supply the shared storage implementation. The abstract service adds no model input.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Consumers use `ctx.sessionLease`. Mount the [PostgreSQL provider](../session-lease-postgres/README.md) to register a concrete implementation; this abstract service alone supplies no database connection.

### Observable behavior

A free or expired lease can be acquired atomically; a live foreign lease returns its holder and expiry. Only the owner may renew or release. `waitLost` resolves when ownership is lost and accepts cancellation.

-----

<a id="model-experience"></a>
## Model Experience

### Cross-node session execution

#### What the model sees

Nothing directly. `ctx.sessionLease` coordinates host-side session work without adding prompts, tools, or schemas.

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

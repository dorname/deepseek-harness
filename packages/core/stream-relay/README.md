---
description: "Service Definition: cross-node relay of one session's events and assistant-stream frames by monotonic sequence."
kind: "package-reference"
---

# @deepseek-ai/dsh-stream-relay

English | [中文](README.zh.md)

## Summary

Service Definition: cross-node relay of one session's events and assistant-stream frames by monotonic sequence. The package is host-side only: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load it in a profile's `cordis.yml` alongside the rest of the execution-pool deployment (`session-persistence-postgres` for durable logs); runner nodes mount the lease and dispatch, Web/API replicas mount the relay subscription.

### Observable behavior

A fresh shared database is stamped with the physical layout version inside one transaction; any other stamped version rejects — no migration, pre-release stance. Lease acquire/renew/release and relay publish/read reject loudly on a medium failure; `waitLost` and relay subscriptions settle or cancel cleanly with their signals.

-----

<a id="model-experience"></a>
## Model Experience

### Cross-node session execution

#### What the model sees

Nothing. This package contributes no prompt, tool, or schema; it arbitrates or transports session state behind Cordis services for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the package never touches live request prefixes.

## Known Limitations and Deferred Work

- **Pre-release physical layout** — any foreign stamped layout version refuses rather than migrates.
- **Provider-local semantics** — the package owns no retention or cleanup; the shared tables accumulate until removed externally.
- **The database and schema must pre-exist** — the provider creates tables, never databases; connection or permission failures surface at the first use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

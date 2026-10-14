---
description: "Stateless webhook ingress: signature-checked events queued in one shared database, consumed exactly once into Workspace Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-ingress

English | [中文](README.zh.md)

## Summary

Queue external events in shared PostgreSQL storage and let consumer nodes create Workspace Sessions through a callback. Repeated submissions with one dedupe key share one queue row. Consumers lock pending rows during delivery; a failure before commit leaves the event available for retry. Session creation must be idempotent by dedupe key because callback invocation is at least once. HTTP entry, consumption, and session execution can be deployed separately.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Entry replicas mount `enqueue` behind the HTTP route; consumer nodes mount `runConsumer`:

```yaml
plugins:
  '@deepseek-ai/dsh-webhook-ingress':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_webhook
```

| Field | Default | Meaning |
|---|---|---|
| `connectionString` | required | `postgres://` connection string of the shared events database |
| `max` | `2` | Connection pool size |
| `pollMs` | `250` | Fallback polling interval while waiting for pending events |
| `consume` | required | Consume callback: create the Workspace Session and hand its id to the execution pool |

### Observable behavior

A fresh database is stamped with the physical layout version inside one transaction; any other stamped version rejects — no migration, pre-release stance. Consume is at-least-once per event: a throw rolls the take back and the next round recreates, so session creation must be idempotent by dedupe key.

-----

<a id="model-experience"></a>
## Model Experience

### Cluster webhook entry

#### What the model sees

The package adds no prompt or tool schema. The `consume` callback owns session creation and model-visible input; the ingress only queues and delivers events.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the package never touches live request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Pre-release physical layout** — any foreign stamped layout version refuses rather than migrates.
- **At-least-once consume** — a crash between session creation and commit can re-consume one event; session creation must be idempotent by dedupe key.
- **The database and schema must pre-exist** — the provider creates tables, never databases; connection or permission failures surface at the first use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

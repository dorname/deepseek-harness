---
description: "Stateless webhook ingress: signature-checked events queued in one shared database, consumed exactly once into Workspace Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-ingress

English | [中文](README.zh.md)

## Summary

`dsh-webhook-ingress` is the stateless webhook entry for cluster deployments: entry replicas verify the HMAC-SHA256 signature and queue the event into one shared `webhook_events` table (the dedupe key is the primary key, so replicated entries and sender retries collapse to one row) plus a `NOTIFY` wake, then respond immediately. The consumer loop takes pending events with `FOR UPDATE SKIP LOCKED`, creates the Workspace Session through the injected consume callback, and marks the event done in the same transaction — a crash rolls the take back and the next round recreates, so no event is lost and no session is duplicated. The created session's id goes to the execution-pool queue; entry, consumption, and execution scale independently. The package is host-side only.

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

Nothing. This package contributes no prompt, tool, or schema; it queues external events behind Cordis services for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the package never touches live request prefixes.

## Known Limitations and Deferred Work

- **Pre-release physical layout** — any foreign stamped layout version refuses rather than migrates.
- **At-least-once consume** — a crash between session creation and commit can re-consume one event; session creation must be idempotent by dedupe key.
- **The database and schema must pre-exist** — the provider creates tables, never databases; connection or permission failures surface at the first use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

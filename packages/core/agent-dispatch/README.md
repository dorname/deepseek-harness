---
description: "Dispatch queue and runner orchestration: publish session ids, lease them, resume from the shared inbox, cancel on lease loss."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-dispatch

English | [中文](README.zh.md)

## Summary

`dsh-agent-dispatch` is the execution-pool dispatch queue plus its runner orchestration loop. Entry points publish a session id to a shared table (`INSERT … ON CONFLICT DO NOTHING`, so one session is queued at most once); runner nodes take one queued id, acquire its session lease, resume the session from shared persistence (the durable inbox projection drives continuation), cancel the agent the moment `waitLost` settles, and release when idle. `agent-loop` never sees a lease. The package is host-side only: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Runner nodes mount the loop alongside the session-lease provider and the persistence backend:

```yaml
plugins:
  '@deepseek-ai/dsh-agent-dispatch':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_dispatch
    nodeId: runner-a
```

| Field | Default | Meaning |
|---|---|---|
| `connectionString` | required | `postgres://` connection string of the shared dispatch database |
| `max` | `2` | Connection pool size |
| `nodeId` | none (loop requires it) | This runner's lease identity |
| `leaseTtlMs` | `2000` | Lease lifetime; the heartbeat interval derives from it |
| `pollMs` | `250` | Fallback polling interval while waiting for queued work |
| `idleGraceMs` | `5000` | Grace period after an idle agent before the lease releases |

### Observable behavior

A fresh database is stamped with the physical layout version inside one transaction; any other stamped version rejects — no migration, pre-release stance. A lease that never becomes free parks the session behind the retry poll, never concurrent execution; a lost lease cancels the agent and releases the row so the session can re-enter the queue.

-----

<a id="model-experience"></a>
## Model Experience

### Execution-pool dispatch

#### What the model sees

Nothing. This package contributes no prompt, tool, or schema; it orchestrates session execution behind Cordis services for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the package never touches live request prefixes.

## Known Limitations and Deferred Work

- **Pre-release physical layout** — any foreign stamped layout version refuses rather than migrates.
- **The queue is deployment-scoped, not per-user-namespaced** — sessions already carry their fleet subject by the time they reach dispatch; the table is a plain `session_id` queue.
- **The database and schema must pre-exist** — the provider creates tables, never databases; connection or permission failures surface at the first use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

---
description: "Shared schedule dispatch: due rows in one shared database, taken exactly once per delivery via FOR UPDATE SKIP LOCKED."
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule-dispatch

English | [中文](README.zh.md)

## Summary

`dsh-schedule-dispatch` is the cluster form of schedule delivery: due rows live in one shared `schedule_due` table (one row per task, `next_due_at` advancing monotonically), and runner nodes run the dispatch loop — take the newest due row with `FOR UPDATE SKIP LOCKED`, acquire the session lease, deliver, and advance next-due inside one transaction whose row lock is the exactly-once take guarantee. A crash before commit rolls the row back, so reminders are never lost; a recurring row skips whole missed periods and lands on the first strictly future instant, so only the latest missed occurrence is delivered. The single-host `ScheduleService` is the parallel form: without the shared database configured, Host-timer behavior is unchanged. The package is host-side only: it contributes no prompt, tool, or schema.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Runner nodes mount the loop alongside the session-lease provider; the `deliver` callback resumes the session and appends the reminder.

```yaml
plugins:
  '@deepseek-ai/dsh-schedule-dispatch':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_schedule
    nodeId: runner-a
```

| Field | Default | Meaning |
|---|---|---|
| `connectionString` | required | `postgres://` connection string of the shared schedule database |
| `max` | `2` | Connection pool size |
| `nodeId` | none (loop requires it) | This runner's lease identity |
| `leaseTtlMs` | `2000` | Lease lifetime for the delivery window |
| `pollMs` | `250` | Fallback polling interval while waiting for due work |
| `deliver` | required | Delivery callback: resume the session and append the reminder |

### Observable behavior

A fresh database is stamped with the physical layout version inside one transaction; any other stamped version rejects — no migration, pre-release stance. Delivery is at-least-once per occurrence: a throw rolls the take back and the next round redelivers. A held session lease leaves the row due for the owner.

-----

<a id="model-experience"></a>
## Model Experience

### Cluster reminder delivery

#### What the model sees

Nothing. This package contributes no prompt, tool, or schema; it delivers scheduled reminders behind Cordis services for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the package never touches live request prefixes.

## Known Limitations and Deferred Work

- **Pre-release physical layout** — any foreign stamped layout version refuses rather than migrates.
- **Fixed-interval recurrence only** — the shared form carries `once` and `interval:<ms>` rows; daily/weekly/cron wall-clock rules remain the single-host `ScheduleService` form.
- **The database and schema must pre-exist** — the provider creates tables, never databases; connection or permission failures surface at the first use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

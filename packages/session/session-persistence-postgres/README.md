---
description: "PostgreSQL durable session-persistence backend for hosts pointing several dsh nodes at one shared sessions database."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-postgres

English | [中文](README.zh.md)

## Summary

`dsh-session-persistence-postgres` is a durable session-persistence backend that stores each session's header and committed generation pointer in one `sessions` row, committed generations as immutable byte-range rows, and the newest writes in a live tail, registered as `ctx.sessionPersistence`. Several dsh nodes can point at the same database: a session-level advisory lock arbitrates the single writer, generation publication and pointer advance share one transaction, and a torn tail is never served and is repaired by the next write. The backend is host-side only: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load the backend in a profile's `cordis.yml` (host-side only; nothing here is model-visible):

```yaml
plugins:
  '@deepseek-ai/dsh-session-persistence-postgres':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_sessions
```

| Field | Default | Meaning |
|---|---|---|
| `connectionString` | required | `postgres://` connection string of the shared sessions database |
| `max` | `4` | Connection pool size; every open write handle additionally holds one dedicated connection for its session lock |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-persistence-postgres) is the exhaustive source for every accepted field and its JSDoc.

### Observable behavior

A fresh database is stamped with the physical layout version inside one transaction; any other stamped version rejects — no migration, pre-release stance. A session whose stored format version differs from the build's `SESSION_FORMAT_VERSION` refuses opens with `SessionFormatUnsupportedError` without leaving ownership behind. Duplicate creates reject `SessionAlreadyExistsError`; a second node's write open while another holds the session lock rejects `SessionAlreadyOwnedError`. Appends are contiguous-only and durable once resolved; `flush` is the barrier and folds the tail into a new immutable committed generation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The backend is a generations-plus-tail layout over one connection pool (`postgres`/postgres.js), designed so cross-node semantics are arbitrated by the database itself.

### Design concept

- **Generations are immutable rows.** `session_generations (id, generation, bytes BYTEA)` holds each committed generation's event lines; `INSERT` primary-key conflicts are the failed exclusive publication, the database-side twin of the JSONL backend's `fs.link` EEXIST. Publication and the `sessions.current_generation` pointer advance share one transaction, so a reader never sees a partial generation.
- **The tail is the live prefix.** `session_tail (id, bytes TEXT)` accumulates writes after the committed generations; a final line without its terminator is a torn tail — the read path never serves it, and the next write open truncates it away. Committed generation rows are never rewritten.
- **One writer per session, arbitrated in the database.** A write handle holds `pg_try_advisory_lock(hashtext(id))` on one dedicated reserved connection from construction through close; process death closes the connection and releases the lock, exactly where the JSONL backend uses a kernel file lock.
- **Same validation vocabulary as every backend.** Create headers, append batches, contiguity, stored-event vocabulary, and format versioning all flow through the `session-persistence` seam's exported primitives, so refusals are identical across backends.
- **Pool warmed at connect.** Every pool connection is established (and verified by one round trip) during `connectDatabase`, so a write handle's lock connection never forces a lazy connect mid-flight and a fresh connection's failure surfaces at startup.

### Write path

`create` registers the session in-process (visible immediately, no shared-database footprint until the first append or flush). `persistBatch` materializes the `sessions` row plus first generation in one transaction on first write, then appends encoded lines to the tail. `flush` folds the tail into generation `current_generation + 1` under row locks and deletes the tail, all in one transaction. The handle mirrors the JSONL provider's runtime: a per-handle mutation chain, a routed live buffer with a bounded batching window, and a close that drains before releasing ownership.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `SessionPersistence` service — create/open/stat/list, materialize, tail append, generation publication |
| [`src/schema.ts`](src/schema.ts) | Connect sequence, physical layout version, the three tables |
| [`src/format.ts`](src/format.ts) | Event-line encode/decode, torn-tail detection, seeded-cut gate |
| [`src/storage.ts`](src/storage.ts) | Provider-local handle and tracker runtime: mutation chain, live buffer, teardown |
| [`src/lease.ts`](src/lease.ts) | The advisory-lock write lease on a reserved connection |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this backend's view is not enough: the seam contract is authoritative, and the sibling backend shows the single-node medium.

- [Session persistence seam](../session-persistence/README.md) — the service and handle contract every backend implements.
- [Session package map](../README.md) — the family's packages and their repository position.
- [JSONL session backend](../session-persistence-jsonl/README.md) — the filesystem medium for single-node compositions.

-----

<a id="model-experience"></a>
## Model Experience

### Stored session events

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists session logs behind `ctx.sessionPersistence` for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the backend never touches live request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **The database and schema must pre-exist** — the backend creates tables, never databases; connection or permission failures surface at the first use.
- **No historical-generation migration** — unlike the JSONL backend's released-format migrations, this backend stores only the current format; a stored `format_version` mismatch refuses rather than migrates (pre-release stance).
- **No compression** — generation bytes and tail text are stored verbatim; the JSONL backend's Zstandard option has no PostgreSQL counterpart yet.
- **Write handles each hold one pool connection** for their session lock's lifetime, so `max` must cover the expected concurrent appending handles plus readers.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The shared live-write contract suite runs parts of its assertions inside `vi.useFakeTimers()` windows while still awaiting real backend I/O. postgres.js schedules socket writes through `setImmediate`, so this package's spec keeps `setImmediate` real via a file-level `vi.setConfig({ fakeTimers: { toFake: [...] } })`; the suites' batching-window timers stay faked. The pool warm-up in `connectDatabase` is what makes that sufficient: no connection is ever established lazily inside a fake-timer window.

</details>

---
description: "PostgreSQL storage backend for hosts and maintainers pointing several dsh nodes at one shared KV medium."
kind: "package-reference"
---

# @deepseek-ai/dsh-storage-postgres

English | [中文](README.zh.md)

## Summary

`dsh-storage-postgres` is a storage backend that hosts every routed unit in one shared PostgreSQL database, storing each record as one JSON document per row, registered as backend `postgres`. Several dsh nodes can point at the same database: table creation is serialized through advisory locks, and per-user namespaces are layered on top by the domain facility, so two nodes opening the same domain never see each other's data. The backend is host-side only: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when a deployment shares domain data across several dsh nodes (a user fleet pointing at one database) or prefers a PostgreSQL medium for operational reasons; single-machine compositions without such a database should stay on `storage-sqlite`.

### When to choose it

Choose it when the medium must outlive and outspan one machine: the database, not the local disk, owns the data. Each key maps to exactly one row like the SQLite backend, but the driver is asynchronous and the medium is a separate server process, so a `version-mismatch` or connection failure surfaces as a rejected open instead of a local file error.

### Configuration

Two fields: the connection string and the pool size. The database (and schema) must already exist; the backend creates its tables on connect.

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-postgres'
  config:
    connectionString: postgres://dsh:secret@db.internal:5432/dsh
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: postgres
```

| Field | Default | Meaning |
|---|---|---|
| `connectionString` | required | `postgres://` connection string of the shared database |
| `max` | `1` | Connection pool size; the domain layer serializes writes per unit, so raise it only for many concurrent readers |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-storage-postgres) is the exhaustive source for every accepted field and its JSDoc.

### Observable behavior

A fresh database is stamped with the physical layout version inside one transaction; any other stamped version rejects `version-mismatch` — no migration, pre-release stance. A unit whose stored format version differs from its descriptor rejects `version-mismatch`. Unit and table names outside the storage hub's unit-name pattern reject, as do physical identifiers over PostgreSQL's 63-byte limit. Failures carry stable `StorageError` codes, and writes are durable once resolved.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The backend is a document-per-row layout over one connection pool (`postgres`/postgres.js), designed so a per-key update is a single statement and DDL is race-free across nodes.

### Design concept

- **Document per row.** Each unit table becomes a physical table `u_<unit>_<table> (key TEXT PRIMARY KEY, value TEXT)` whose `value` column holds the record's JSON text; the global singleton lives in a shared `unit_globals` table, mirroring the SQLite backend's physical habits.
- **Single-statement atomicity.** Every write primitive is one statement, so PostgreSQL's per-statement atomicity satisfies the KV contract; write ordering stays the caller's responsibility (the domain layer's write chain).
- **DDL serialized by advisory locks.** Every DDL transaction takes a transaction-scoped `pg_advisory_xact_lock` (shared layout, then per unit), because concurrent `CREATE TABLE IF NOT EXISTS` of one name crashes on PostgreSQL's type-catalog unique index even between two nodes — the exact shape of two dsh nodes starting against an empty shared database.
- **Names and lengths validated before DDL.** Unit and table names must match `UNIT_NAME_RE`, and every physical identifier must fit PostgreSQL's 63-byte limit; anything else fails loud instead of colliding under silent truncation.
- **Versions fail loud.** The physical layout version lives in `storage_postgres_meta`; unit format versions live in each unit's `u_<unit>___unit_meta` table. Any other stamped value rejects — no migrations.

### Open sequence

`connectDatabase` opens the pool and ensures the shared layout in one transaction (advisory lock → version check → `storage_postgres_meta` + `unit_globals` → stamp fresh databases last). `kv.open` ensures one unit in a second transaction (advisory lock → per-unit version stamp → record tables), so two nodes opening the same unit race to one atomic commit.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: backend registration, config, unit table, per-unit DDL transaction |
| [`src/schema.ts`](src/schema.ts) | Connect sequence, physical layout version, shared tables, identifier helpers |
| [`src/unit.ts`](src/unit.ts) | One opened unit: statement helpers, JSON value parse, close |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this backend's view is not enough: the subsystem reference is the authoritative contract, and the sibling backends show the alternative media.

- [Storage subsystem](../../../docs/subsystems/storage.md) — the backend contract, domain semantics, and generated API.
- [Storage package map](../README.md) — the family's packages and their repository position.
- [SQLite storage backend](../storage-sqlite/README.md) — the single-file medium for local compositions.

-----

<a id="model-experience"></a>
## Model Experience

### Stored domain records

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists non-session domain data behind `ctx.storage` for host-side consumers only.

#### Token effect

Zero live-request tokens.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **The database and schema must pre-exist** — the backend creates tables, never databases; connection or permission failures surface at the first use.
- **No connection retry policy** — a failed statement rejects immediately; callers already own retry semantics for domain data.
- **Only the current physical layout version opens** — any other stamped layout or unit version is rejected rather than migrated (pre-release stance).
- **Physical identifiers cap at 63 bytes** — PostgreSQL silently truncates longer identifiers, so oversized unit or table names reject instead of colliding.

-----

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.
</details>

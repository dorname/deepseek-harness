---
description: "PostgreSQL spill backend: oversized tool-result text persisted to one shared database behind opaque references."
kind: "package-reference"
---

# @deepseek-ai/dsh-spill-postgres

English | [中文](README.zh.md)

## Summary

`dsh-spill-postgres` is a spill backend that persists each spilled text as one row in a shared `spill_texts` table keyed by a backend-minted opaque reference, registered as `ctx.spillStore`. Several dsh nodes can point at the same database, and the fleet subject injected through `DSH_FLEET_USER_ID` derives the namespace column, so two nodes with different subjects never see each other's spills. The seam stays deliberately minimal: `saveText` and nothing else — retention, replacement, and retrieval remain their owning packages' concerns.

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
  '@deepseek-ai/dsh-spill-postgres':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_spill
```

| Field | Default | Meaning |
|---|---|---|
| `connectionString` | required | `postgres://` connection string of the shared spill database |
| `max` | `2` | Connection pool size |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-spill-postgres) is the exhaustive source for every accepted field and its JSDoc.

### Observable behavior

A fresh database is stamped with the physical layout version inside one transaction; any other stamped version rejects — no migration, pre-release stance. `saveText` persists the full content verbatim, scoped by the owning session, and returns an opaque `pgspill_`-prefixed reference with its exact byte length and model-facing retrieval guidance; a storage failure rejects loudly for the caller to degrade.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

- **Opaque reference, no storage coordinates.** The locator is a random backend-minted `pgspill_<hex>` string; consumers never parse it, and it names no table or row.
- **Namespace from the injected fleet subject.** The same digest rule as the storage hub's domain namespaces (`u` + 16-hex sha256 of the subject); absent injection stores under the default empty namespace.
- **One seam method.** `saveText` is the whole backend; the Service Definition owns no retention, replacement, or retrieval vocabulary.
- **Connection lifecycle as one effect.** The pool opens lazily (failures surface at first use) and closes through a single context effect.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `SpillStore` service — layout ensure and `saveText` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Spill package map](../README.md) — the family's packages and their repository position.
- [Local spill backend](../spill-local/README.md) — the filesystem medium for single-node compositions.

-----

<a id="model-experience"></a>
## Model Experience

### Spilled tool-result text

#### What the model sees

The locator and retrieval hint this backend's references carry inside the spilled result placeholder; nothing else changes in the request.

#### Token effect

Zero live-request tokens — spilling replaces oversized inline text, it never adds any.

#### KV Cache effect

None — the backend never touches live request prefixes.

## Known Limitations and Deferred Work

These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **No read API** — the seam exposes `saveText` only; retrieval is an operator concern against the shared medium by reference.
- **No retention policy** — spills accumulate until removed externally; the owning retention package governs cleanup.
- **The database and schema must pre-exist** — the backend creates tables, never databases; connection or permission failures surface at the first use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

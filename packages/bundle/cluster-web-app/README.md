---
description: "dsh cluster-web API profile bundle: same-origin API replicas without the SPA, on shared Postgres persistence, via `dsh --profile cluster-web-api`."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cluster-web-app

English | [中文](README.zh.md)

## Summary

`dsh-cluster-web-app` is the composition bundle behind `dsh --profile cluster-web-api`. It layers over `dsh-web-app` and turns one dsh process into a cluster-web API replica: the SPA fallback stays off (a same-origin shell or edge serves the frontend), local JSONL persistence is replaced by shared Postgres session persistence and stream relay, and every replica behind one origin shares session state. See [deploy/cluster-web](../../../deploy/cluster-web/README.md) for the topology that launches these replicas.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

`dsh --profile cluster-web-api --no-open --host 127.0.0.1 --port <port>` boots one API replica behind a same-origin edge. The Postgres rows read the connection string from the environment; an unset value fails the boot at plugin validation instead of falling back to local persistence.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Required `postgres://` connection string of the shared session database |

-----

<a id="model-experience"></a>
## Model Experience

None, as this bundle only swaps persistence and frontend serving; every model-facing effect is owned by the layers underneath.

#### KV Cache effect

None; the persistence swap changes where session bytes land, not what a model request contains.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One shared database** — every replica reads the same `DATABASE_URL`; per-replica databases are not a composition this bundle offers.
- **Pool size fixed at 2** — the Postgres pool `max` matches the acceptance topology; raise it by patching the inserted rows in a later profile layer when a deployment outgrows it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `web-runtime` override restates every key the `dsh-web-app` row owns, because a patch replaces the targeted row's whole `config`; dropping a key here silently removes runtime glue from every API replica.

</details>

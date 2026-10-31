---
description: "dsh cluster-web runner profile bundle: dispatch-runner replicas with Postgres session leases and the auto-starting agent dispatch loop, via `dsh --profile cluster-web-runner`."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cluster-web-runner-app

English | [中文](README.zh.md)

## Summary

`dsh-cluster-web-runner-app` is the composition bundle behind `dsh --profile cluster-web-runner`. It layers over `dsh-cluster-web-app` and adds what a runner replica needs beyond the API composition: the Postgres session lease and `agent-dispatch` with `runner: true`, so the dispatch loop starts at mount, claims queued sessions, and drives them. See [deploy/cluster-web](../../../deploy/cluster-web/README.md) for the topology that launches these replicas.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

`dsh --profile cluster-web-runner --no-open --host 127.0.0.1 --port <port>` boots one runner replica. The dispatch loop requires a lease identity; an unset `DSH_NODE_ID` fails the mount inside `agent-dispatch`.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Required `postgres://` connection string of the shared session database |
| `DSH_NODE_ID` | Required lease identity of this runner (for example `runner-1`); must be unique among live runners |

-----

<a id="model-experience"></a>
## Model Experience

None, as this bundle only adds orchestration rows; every model-facing effect is owned by the layers underneath.

#### KV Cache effect

None; dispatch and leases schedule work, they do not change what a model request contains.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No cross-runner mutual exclusion beyond leases** — two runners given the same `DSH_NODE_ID` split each other's leases; the launcher owns uniqueness.
- **Poll fallback stays at 250 ms** — `pollMs` matches the acceptance topology; tune it by patching the `agent-dispatch` row in a later profile layer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`runner: true` is what starts the dispatch loop at mount; the loop reads `nodeId` from the same row and rejects the mount without it. The pre-bundle `runner.overlay.yml` passed only `nodeId`, which the current `agent-dispatch` schema ignores — this bundle ports the plugin's current contract, not that stale overlay.

</details>

---
description: "Same-origin cluster-web Compose one-click topology: edge + loopback API replicas, optional runners and Postgres."
kind: "reference"
---

# cluster-web (Compose · P0)

English | [中文](README.zh.md)

## Summary

One-click same-origin deployment: a Node edge publishes one origin; a **shell** process serves the SPA (`serveFrontend: true`); **API-only** replicas (`--api-only` / `serveFrontend: false`) and optional runners stay on `127.0.0.1`. Compose adds Postgres. Acceptance keeps replicas low so verify cannot blow host CPU.

## One-click

```sh
# From repository root (requires Docker):
cp deploy/cluster-web/.env.example deploy/cluster-web/.env
# Image build has no .git — pass the commit hash for client build metadata:
DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
  docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build
# Open PUBLIC_URL (default http://127.0.0.1:8080/)
```

Without Docker, prefer the CLI (P1):

```sh
# After pnpm install && pnpm run build; no shared DB → plain web + edge:
pnpm dsh up --edge-port 8080 --api-replicas 1 --runner-replicas 0 --skip-overlays --skip-runners
```

Or call supervise directly:

```sh
CLUSTER_WEB_SKIP_OVERLAYS=1 CLUSTER_WEB_SKIP_RUNNERS=1 API_REPLICAS=1 EDGE_PORT=8080 \
  node --import tsx/esm deploy/cluster-web/supervise.mts
```

Stop with SIGTERM/SIGINT; supervise drains children.

## Topology

| Role | Bind | Notes |
|------|------|--------|
| edge | `0.0.0.0:EDGE_PORT` | Only public listener; preserves `Host`; `/`+`/plugins`→shell; `/api` round-robin |
| shell | `127.0.0.1:SHELL_PORT` | SPA + `/?token=` exchange + `/plugins` (`serveFrontend: true`) |
| api × N | `127.0.0.1:3080+` | API-only (`--api-only`); optional Postgres overlay |
| runner × M | `127.0.0.1:3180+` | Private web keep-alive + dispatch overlay; not on edge |
| postgres | compose service | Optional when `DATABASE_URL` set |

`--host 0.0.0.0` remains rejected on dsh; the edge is the intentional public socket. Shell and all API replicas share `$DSH_HOME` so session cookies verify across the API pool.

## External frontend contract

To replace the in-tree shell with an independent front (same browser origin via this edge or an equivalent reverse proxy):

1. Keep a **single browser origin**; route `/api` to API replicas and `/` (plus `/plugins` if used) to the front.
2. Provide equivalent **boot injection** and **`GET /?token=` → cookie** exchange (or a future bootstrap path).
3. Do **not** deploy the front on a different origin (no CORS path).

See [Public deployments](../../docs/user/guide/public-deployments.md).

## Acceptance CPU constraints

| Knob | Smoke default | Hard cap |
|------|---------------|----------|
| `API_REPLICAS` | `1` | `2` |
| `RUNNER_REPLICAS` | `0` | `2` |

Smoke runs serially and fails if host CPU peak exceeds `CPU_THRESHOLD_PERCENT` / `scripts/fleet-staging/staging.config.json` (`cpuThresholdPercent`). Do not raise replicas for routine `openlogos smoke`.

## Files

| Path | Role |
|------|------|
| `docker-compose.yml` | Postgres + supervise image |
| `Dockerfile` | Build context = repo root |
| `.env.example` | Public URL, replicas, DB URL |
| `supervise.mts` | Process tree |
| `edge.mts` | Same-origin reverse proxy (`STATIC_UPSTREAM` + `API_UPSTREAMS`) |
| `upstream.mts` | Path → upstream selection |
| `overlays/*.yml` | shell / API / runner `--patch` templates |

## Helm (P2)

```sh
helm upgrade --install dsh deploy/cluster-web/chart -n dsh-cluster-web --create-namespace
```

See [chart/README.md](chart/README.md). Defaults stay at `apiReplicas=1` / `runnerReplicas=0`.

## See also

- [Public deployments](../../docs/user/guide/public-deployments.md) — `--public-url` / `--trusted-host`
- P1 `dsh up` and P2 Helm project the same topology

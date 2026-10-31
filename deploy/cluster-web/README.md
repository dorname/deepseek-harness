---
description: "Same-origin cluster-web Compose: frontend (edge+shell) and scalable api containers sharing DSH_HOME."
kind: "reference"
---

# cluster-web (Compose · S47)

English | [中文](README.zh.md)

## Summary

Same-origin one-click deployment runs **frontend** as the only externally exposed origin (edge + shell). The **api** service runs one container per replica (loopback API-only dsh plus an in-network forwarder) and can scale with `--scale api=2`. Compose marks API replicas healthy through the forwarder's `/healthz` and starts the frontend only after they are ready. The shared `$DSH_HOME` volume lets API containers accept the same browser cookie. Compose also starts Postgres. Processes launch through named dsh profiles: the shell uses `web`, API replicas use `cluster-web-api` (Postgres persistence, `serveFrontend: false`), and optional runners use `cluster-web-runner` (session lease plus agent dispatch). Acceptance keeps replicas low by default to avoid saturating the host during verification.

## Quick start

```sh
# Repository root; Docker is required:
cp deploy/cluster-web/.env.example deploy/cluster-web/.env
DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
  docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build
# Open PUBLIC_URL (default http://127.0.0.1:8080/) with ?token= from the logs.
```

Multiple API containers (maximum 2):

```sh
docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build --scale api=2
```

Without Docker, the process-tree path remains available (S46):

```sh
EDGE_PORT=8080 API_REPLICAS=1 RUNNER_REPLICAS=0 pnpm run cluster-web:up
```

`cluster-web:up` runs `supervise.mts`, which forwards SIGINT and SIGTERM to the process tree and waits for its output streams to close before returning. Every variable lives in [`.env.example`](.env.example); with `DATABASE_URL` unset or `CLUSTER_WEB_SKIP_OVERLAYS=1`, API replicas append the invocation-time patch [`overlays/no-postgres.patch.yml`](overlays/no-postgres.patch.yml) and keep JSONL persistence.

## Topology

| Service | Binding | Role |
|---------|---------|------|
| frontend / edge | `0.0.0.0:EDGE_PORT` | Only public listener; `/` and `/plugins` reach shell, `/api` reaches `api:FORWARD` |
| frontend / shell | `127.0.0.1:SHELL_PORT` | SPA plus `/?token=` cookie exchange |
| api / forwarder | `0.0.0.0:API_FORWARD_PORT` (Compose network only) | Forwards to loopback dsh in its own container |
| api / dsh | `127.0.0.1:API_LOOPBACK_PORT` | `--profile cluster-web-api` (`serveFrontend: false`); never binds `0.0.0.0` |
| postgres | Compose service | Shared API database when `DATABASE_URL` is set |

## External frontend contract

Follow [public deployments](../../docs/user/guide/public-deployments.md): one origin; `/api` reaches the API pool with equivalent boot and token exchange.

## Acceptance CPU limits

| Control | Smoke default | Hard cap |
|---------|---------------|----------|
| `api` scale / `API_REPLICAS` | `1` | `2` |

## Files

| Path | Responsibility |
|------|----------------|
| `docker-compose.yml` | Postgres + frontend + api |
| `frontend.mts` / `api.mts` | Container entrypoints |
| `forward.mts` | In-network API forwarder |
| `edge.mts` / `upstream.mts` | Same-origin reverse proxy |
| `process-helpers.mts` | Shared spawn/wait helpers and the no-Postgres patch args |
| `overlays/no-postgres.patch.yml` | Invocation-time patch: JSONL persistence without Postgres |
| `supervise.mts` | Docker-free process tree (S46) |

The image defaults to `supervise.mts` through Docker `CMD`; Compose replaces it with the dedicated frontend or API entry. SMOKE-core-24 checks each container's PID 1 command and verifies that the shell cookie reaches the API router.

## Helm

The Helm chart projects the same frontend/api split into Kubernetes. See [chart/README.md](chart/README.md) for image preparation and `apiReplicas` scaling.

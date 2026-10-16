---
description: "Same-origin cluster-web Compose: frontend (edge+shell) and scalable api containers sharing DSH_HOME."
kind: "reference"
---

# cluster-web (Compose · S47)

English | [中文](README.zh.md)

## Summary

Same-origin one-click deployment runs **frontend** as the only externally exposed origin (edge + shell). The **api** service runs one container per replica (loopback API-only dsh plus an in-network forwarder) and can scale with `--scale api=2`. Compose marks API replicas healthy through the forwarder's `/healthz` and starts the frontend only after they are ready. The shared `$DSH_HOME` volume lets API containers accept the same browser cookie. Compose also starts Postgres. Acceptance keeps replicas low by default to avoid saturating the host during verification.

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

`dsh up` forwards SIGINT and SIGTERM to its supervisor and waits for the process tree and its output streams to close before returning.

```sh
pnpm dsh up --edge-port 8080 --api-replicas 1 --runner-replicas 0 --skip-overlays --skip-runners
```

## Topology

| Service | Binding | Role |
|---------|---------|------|
| frontend / edge | `0.0.0.0:EDGE_PORT` | Only public listener; `/` and `/plugins` reach shell, `/api` reaches `api:FORWARD` |
| frontend / shell | `127.0.0.1:SHELL_PORT` | SPA plus `/?token=` cookie exchange |
| api / forwarder | `0.0.0.0:API_FORWARD_PORT` (Compose network only) | Forwards to loopback dsh in its own container |
| api / dsh | `127.0.0.1:API_LOOPBACK_PORT` | `--api-only`; never binds `0.0.0.0` |
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
| `supervise.mts` | Docker-free process tree (S46) |

The image defaults to `supervise.mts` through Docker `CMD`; Compose replaces it with the dedicated frontend or API entry. SMOKE-core-24 checks each container's PID 1 command and verifies that the shell cookie reaches the API router.

## Helm

The Helm chart projects the same frontend/api split into Kubernetes. See [chart/README.md](chart/README.md) for image preparation and `apiReplicas` scaling.

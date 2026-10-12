---
description: "Same-origin cluster-web Compose: frontend (edge+shell) and scalable api containers sharing DSH_HOME."
kind: "reference"
---

# cluster-web (Compose · S47)

[English](README.md) | [中文](README.zh.md)

## Summary

Same-origin one-click deploy: **frontend** exposes one origin (edge + shell); **api** is one container per replica (loopback API-only + in-network forwarder), scalable with `--scale api=2`. Shared `$DSH_HOME` volume makes cookies valid across api containers. See [README.zh.md](README.zh.md) for full Chinese docs.

## Quick start

```sh
cp deploy/cluster-web/.env.example deploy/cluster-web/.env
DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
  docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build
# Open PUBLIC_URL with ?token= from frontend logs
```

Scale API containers (cap 2):

```sh
docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build --scale api=2
```

Without Docker, the process-tree path remains: `pnpm dsh up --edge-port 8080 --api-replicas 1 --skip-overlays --skip-runners`.

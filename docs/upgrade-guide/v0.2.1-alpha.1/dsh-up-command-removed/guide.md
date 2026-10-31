---
kind: upgrade-guide
description: "The `dsh up` command is removed; the cluster-web process tree launches through `pnpm run cluster-web:up`."
---

# `dsh up` is removed; use `pnpm run cluster-web:up`

English | [中文](guide.zh.md)

## Change

In v0.2.1-alpha.1, `dsh up` (or `dsh --profile up`) started the cluster-web process tree with the flags `--edge-port`, `--api-replicas`, `--runner-replicas`, `--skip-overlays`, and `--skip-runners`. It wrapped `deploy/cluster-web/supervise.mts` behind a profile-shaped command while overriding the shipped `web` profile at launch time.

The next release removes the command and its flags. `dsh up` now treats `up` as a profile name and fails with `profile "up" does not exist`. The supervisor remains reachable as the root script `cluster-web:up`, configured by environment variables, and every replica boots a named profile (`web`, `cluster-web-api`, `cluster-web-runner`).

## Migration

1. Replace `pnpm dsh up <flags>` with `pnpm run cluster-web:up`, translating each flag to its environment variable: `--edge-port` → `EDGE_PORT`, `--api-replicas` → `API_REPLICAS`, `--runner-replicas` → `RUNNER_REPLICAS`, `--skip-overlays` → `CLUSTER_WEB_SKIP_OVERLAYS=1`, `--skip-runners` → `CLUSTER_WEB_SKIP_RUNNERS=1`. For example:

   ```sh
   EDGE_PORT=8080 API_REPLICAS=1 RUNNER_REPLICAS=0 CLUSTER_WEB_SKIP_OVERLAYS=1 CLUSTER_WEB_SKIP_RUNNERS=1 \
     pnpm run cluster-web:up
   ```

2. Copy `deploy/cluster-web/.env.example` to `deploy/cluster-web/.env` for the remaining variables (`DATABASE_URL`, `PUBLIC_URL`, `TRUSTED_HOST`, ports).
3. Confirm: `pnpm run cluster-web:up` prints `cluster-web-supervise: ready`, and `dsh up` exits with `profile "up" does not exist`.

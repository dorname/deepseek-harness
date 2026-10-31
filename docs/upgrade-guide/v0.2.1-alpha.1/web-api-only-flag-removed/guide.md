---
kind: upgrade-guide
description: "`dsh web --api-only` is removed; API-only processes boot the `cluster-web-api` profile."
---

# `--api-only` is removed; use the `cluster-web-api` profile

English | [中文](guide.zh.md)

## Change

In v0.2.1-alpha.1, `dsh web` accepted `--api-only`, which booted the Web application without serving the SPA. The flag bypassed the profile system's composition rules by turning a profile command into a deployment role switch.

The next release removes `--api-only` (and the `apiOnly` web option). API-only processes boot the named profile `cluster-web-api`: base + web-app + the `@deepseek-ai/dsh-cluster-web-app` bundle, which sets `serveFrontend: false` and replaces JSONL persistence with `session-persistence-postgres` and `stream-relay-postgres` reading `DATABASE_URL`. `dsh web --api-only ...` now exits with `error: unknown option '--api-only'`.

## Migration

1. Replace `dsh web --api-only ...` with `dsh --profile cluster-web-api ...`, keeping the existing `--host`, `--port`, `--public-url`, and `--trusted-host` flags.
2. Set `DATABASE_URL` for the profile's Postgres rows; the boot fails loud with `$.connectionString missing required value` while it is unset.
3. To keep JSONL persistence instead of Postgres, append the invocation-time patch `deploy/cluster-web/overlays/no-postgres.patch.yml` (or a copy): `dsh --profile cluster-web-api --patch <no-postgres patch> ...`.
4. Alternatively keep the `web` profile and apply your own patch that sets `serveFrontend: false` on the `web-runtime` row.
5. Confirm: `dsh --profile cluster-web-api` boots and prints its URL, `GET /` returns 401 with the launch-token exchange intact, and `dsh web --api-only` reports the unknown option.

# Agent Note: cluster-web launches through named profiles

Status: implemented

English | [中文](2026-10-30-cluster-web-named-profiles.zh.md)

## Problem

cluster-web deployments composed their processes by overriding the shipped `web` profile at launch time: a `dsh up` command wrapped the deploy supervisor behind a profile-shaped CLI verb, ordered overlays rewrote plugin rows per role, and `dsh web --api-only` turned a profile command into a deployment role switch. This diverged from the launcher rule [one dsh launcher for application profiles](2026-08-22-single-dsh-application-launcher.md) and from the independent-profile precedent that `acp-network` had since established, and it broke concretely: `dsh up` resolves `deploy/cluster-web/supervise.mts` from a repository checkout, so it cannot work in a released install, where profiles are the only composition that ships. The [20261012-0112 decision](../../../../logos/changes/archive/20261012-0112-cluster-web-dsh-up/proposal.md) that chose "`dsh up`, not a new profile" predates both the rule and the precedent, and its overlay path let composition drift silently: the runner overlay never set `runner: true`, so the agent-dispatch loop had stopped running without any failing signal.

## Decision

cluster-web follows the same launch rule as `acp-network`: roles are named profiles over thin additive bundles, and the deploy tree contains no composition logic.

- `@deepseek-ai/dsh-cluster-web-app` patches `web-runtime` to `serveFrontend: false`, disables `session-persistence-jsonl`, and inserts `session-persistence-postgres` and `stream-relay-postgres`, both reading `DATABASE_URL` (missing variable fails loud at config validation).
- `@deepseek-ai/dsh-cluster-web-runner-app` adds `session-lease-postgres` and `agent-dispatch` (`nodeId` from `DSH_NODE_ID`, `runner: true`, `pollMs: 250`) on top of the api composition; a missing `DSH_NODE_ID` throws at mount.
- The shipped profiles are `cluster-web-api` (base + web-app + cluster-web-app) and `cluster-web-runner` (the same plus runner-app).
- The `dsh up` command is removed; the root script `cluster-web:up` runs `supervise.mts`, configured by environment variables. The `--api-only` flag is removed; the `web` profile's own patch pins `serveFrontend: true`.
- Deploy entries boot profiles only: the frontend shell uses `--profile web`, API replicas `--profile cluster-web-api`, runners `--profile cluster-web-runner` with `DSH_NODE_ID`. Without Postgres, API replicas append the invocation-time patch `deploy/cluster-web/overlays/no-postgres.patch.yml` (disables the Postgres rows, re-enables JSONL) rather than baking a fallback into the bundle.
- [`verify-application-entrypoints`](../../../../scripts/verify-application-entrypoints.ts) path-classifies every `deploy/` entry script (`DEPLOY_ENTRY_CLASSIFICATIONS`) and pins `cluster-web:up` in `ROOT_LAUNCHER_POLICIES`, so a new deploy entry without an explicit role fails the gate.

## Alternatives considered

**Keep `dsh up` with overlays (the overturned 20261012-0112 decision).** It lost on three counts: it depends on a repository checkout that released installs do not have; it contradicts the one-launcher rule the repository had since codified; and its silent row replacement hid the agent-dispatch contract drift. Rollback simplicity ("delete the overlay") did not require the command form.

**One thick `cluster-web` profile with role flags.** Rejected: the runner is exactly the api composition plus two rows, which ordered bundle layers already express; flags would reintroduce a `--api-only`-style role switch inside a profile command.

**Bake the no-Postgres fallback into the bundle.** Rejected: the bundle's fail-loud `DATABASE_URL` contract is what makes a misconfigured deployment visible; whether Postgres is available is an invocation-time deployment fact, so the choice stays an invocation-time patch.

## Consequences

Cost: two more shipped profiles to document, two upgrade guides (`--api-only` removal, `dsh up` removal), and operators translating `dsh up` flags to environment variables. Bought: one launch paradigm across every deployment topology; released installs can run cluster-web because the bundles ship as CLI dependencies; composition drift now fails at config load instead of silently disabling rows; and the deploy tree is reduced to process orchestration that the entrypoint gate can classify exhaustively.

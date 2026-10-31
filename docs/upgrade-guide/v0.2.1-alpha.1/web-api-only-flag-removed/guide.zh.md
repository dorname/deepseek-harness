---
kind: upgrade-guide
description: "`dsh web --api-only` 移除；API-only 进程改用 `cluster-web-api` profile 启动。"
---

# `--api-only` 移除；改用 `cluster-web-api` profile

[English](guide.md) | 中文

## 变更

v0.2.1-alpha.1 中 `dsh web` 接受 `--api-only`，以不服务 SPA 的方式启动 Web 应用。该 flag 把 profile 命令变成部署角色开关，绕过了 profile 体系的组合规则。

下一版本移除 `--api-only`（及 `apiOnly` web 选项）。API-only 进程改用具名 profile `cluster-web-api` 启动：base + web-app + `@deepseek-ai/dsh-cluster-web-app` bundle，后者设置 `serveFrontend: false`，并将 JSONL 持久化替换为读取 `DATABASE_URL` 的 `session-persistence-postgres` 与 `stream-relay-postgres`。`dsh web --api-only ...` 现以 `error: unknown option '--api-only'` 退出。

## 迁移

1. 将 `dsh web --api-only ...` 替换为 `dsh --profile cluster-web-api ...`，保留原有的 `--host`、`--port`、`--public-url`、`--trusted-host` flag。
2. 为 profile 的 Postgres 行设置 `DATABASE_URL`；未设置时启动会以 `$.connectionString missing required value` 显式失败。
3. 若要保留 JSONL 持久化，追加调用时补丁 `deploy/cluster-web/overlays/no-postgres.patch.yml`（或其副本）：`dsh --profile cluster-web-api --patch <no-postgres 补丁> ...`。
4. 或者继续用 `web` profile，并自行打补丁把 `web-runtime` 行设为 `serveFrontend: false`。
5. 确认：`dsh --profile cluster-web-api` 启动并打印 URL，`GET /` 返回 401 且启动 token 换票仍可用，`dsh web --api-only` 报未知选项。

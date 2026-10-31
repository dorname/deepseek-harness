---
kind: upgrade-guide
description: "`dsh up` 命令移除；cluster-web 进程树改经 `pnpm run cluster-web:up` 启动。"
---

# `dsh up` 移除；改用 `pnpm run cluster-web:up`

[English](guide.md) | 中文

## 变更

v0.2.1-alpha.1 中 `dsh up`（或 `dsh --profile up`）以 `--edge-port`、`--api-replicas`、`--runner-replicas`、`--skip-overlays`、`--skip-runners` 启动 cluster-web 进程树。它在 profile 形态的命令背后包装 `deploy/cluster-web/supervise.mts`，却在启动时覆盖出厂 `web` profile。

下一版本移除该命令及其 flag。`dsh up` 现将 `up` 视为 profile 名并以 `profile "up" does not exist` 失败。supervisor 改由根脚本 `cluster-web:up` 承载，以环境变量配置，各副本均以具名 profile（`web`、`cluster-web-api`、`cluster-web-runner`）启动。

## 迁移

1. 将 `pnpm dsh up <flags>` 替换为 `pnpm run cluster-web:up`，逐个 flag 换成环境变量：`--edge-port` → `EDGE_PORT`、`--api-replicas` → `API_REPLICAS`、`--runner-replicas` → `RUNNER_REPLICAS`、`--skip-overlays` → `CLUSTER_WEB_SKIP_OVERLAYS=1`、`--skip-runners` → `CLUSTER_WEB_SKIP_RUNNERS=1`。例如：

   ```sh
   EDGE_PORT=8080 API_REPLICAS=1 RUNNER_REPLICAS=0 CLUSTER_WEB_SKIP_OVERLAYS=1 CLUSTER_WEB_SKIP_RUNNERS=1 \
     pnpm run cluster-web:up
   ```

2. 其余变量（`DATABASE_URL`、`PUBLIC_URL`、`TRUSTED_HOST`、端口）复制 `deploy/cluster-web/.env.example` 为 `deploy/cluster-web/.env`。
3. 确认：`pnpm run cluster-web:up` 打印 `cluster-web-supervise: ready`，`dsh up` 以 `profile "up" does not exist` 退出。

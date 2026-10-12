---
description: "同域 cluster-web Compose 一键拓扑：edge + shell + API-only 副本，可选 runner 与 Postgres。"
kind: "reference"
---

# cluster-web（Compose · P0）

[English](README.md) | 中文

## 摘要

同域一键部署：Node edge 对外只暴露一个 origin；**shell** 提供 SPA（`serveFrontend: true`）；**API-only** 副本（`--api-only` / `serveFrontend: false`）与可选 runner 只绑 `127.0.0.1`。Compose 附带 Postgres。验收默认低副本，避免 verify 打爆主机 CPU。

## 一键启动

```sh
# 仓库根目录（需要 Docker）：
cp deploy/cluster-web/.env.example deploy/cluster-web/.env
# 镜像上下文不含 .git — 传入 commit 供客户端构建元数据：
DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
  docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build
# 打开 PUBLIC_URL（默认 http://127.0.0.1:8080/）
```

无 Docker 时优先用 CLI（P1）：

```sh
# 先 pnpm install && pnpm run build；无共享库 → shell + API-only + edge：
pnpm dsh up --edge-port 8080 --api-replicas 1 --runner-replicas 0 --skip-overlays --skip-runners
```

或直接调用 supervise：

```sh
CLUSTER_WEB_SKIP_OVERLAYS=1 CLUSTER_WEB_SKIP_RUNNERS=1 API_REPLICAS=1 EDGE_PORT=8080 \
  node --import tsx/esm deploy/cluster-web/supervise.mts
```

用 SIGTERM/SIGINT 停止；supervise 会排空子进程。

## 拓扑

| 角色 | 绑定 | 说明 |
|------|------|------|
| edge | `0.0.0.0:EDGE_PORT` | 唯一公网监听；保留 `Host`；`/`+`/plugins`→shell；`/api` 轮询 |
| shell | `127.0.0.1:SHELL_PORT` | SPA + `/?token=` 换票 + `/plugins` |
| api × N | `127.0.0.1:3080+` | API-only（`--api-only`）；可选 Postgres overlay |
| runner × M | `127.0.0.1:3180+` | 私有 web 保活 + dispatch overlay；不进 edge |
| postgres | compose 服务 | 设置 `DATABASE_URL` 时使用 |

dsh 仍拒绝 `--host 0.0.0.0`；对外 socket 只在 edge。shell 与全部 API 共用 `$DSH_HOME`，使会话 cookie 跨 API 互认。

## 外仓前端契约

用独立前端替换本仓 shell（仍经本 edge 或等价反代保持同域）时：

1. 浏览器只看到**一个 origin**；`/api`→API 池，`/`（及 `/plugins`）→前端。
2. 提供等价的 **boot 注入**与 **`GET /?token=` → cookie**（或后续 bootstrap 路径）。
3. **不要**把前端部署在不同 origin（无 CORS 路径）。

见 [公开部署](../../docs/user/guide/public-deployments.zh.md)。

## 验收 CPU 约束

| 旋钮 | 冒烟默认 | 硬上限 |
|------|----------|--------|
| `API_REPLICAS` | `1` | `2` |
| `RUNNER_REPLICAS` | `0` | `2` |

冒烟串行执行；主机 CPU 峰值超过 `CPU_THRESHOLD_PERCENT` / `scripts/fleet-staging/staging.config.json` 的 `cpuThresholdPercent` 即失败。日常 `openlogos smoke` 不得抬高副本。

## 文件

| 路径 | 职责 |
|------|------|
| `docker-compose.yml` | Postgres + supervise 镜像 |
| `Dockerfile` | 构建上下文 = 仓库根 |
| `.env.example` | 公网 URL、副本、库连接 |
| `supervise.mts` | 进程树 |
| `edge.mts` | 同域反代（`STATIC_UPSTREAM` + `API_UPSTREAMS`） |
| `upstream.mts` | 路径 → 上游选择 |
| `overlays/*.yml` | shell / API / runner 的 `--patch` 模板 |

## Helm（P2）

```sh
helm upgrade --install dsh deploy/cluster-web/chart -n dsh-cluster-web --create-namespace
```

见 [chart/README.md](chart/README.md)。默认仍为 `apiReplicas=1` / `runnerReplicas=0`。

## 另见

- [公开部署](../../docs/user/guide/public-deployments.zh.md) — `--public-url` / `--trusted-host`
- P1 `dsh up` 与 P2 Helm 投影同一拓扑

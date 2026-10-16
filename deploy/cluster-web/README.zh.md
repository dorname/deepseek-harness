---
description: "同域 cluster-web Compose：frontend（edge+shell）与可 scale 的 api 容器，共享 DSH_HOME。"
kind: "reference"
---

# cluster-web（Compose · S47）

[English](README.md) | 中文

## 摘要

同域一键部署：**frontend** 容器对外只暴露一个 origin（edge + shell）；**api** 服务每副本一容器（loopback API-only + 内网 forwarder），可用 `--scale api=2` 做容器级多副本。Compose 通过 forwarder 的 `/healthz` 标记 API 副本健康，并在其就绪后才启动 frontend。共享 volume `$DSH_HOME` 使 cookie 跨 api 容器互认。Compose 附带 Postgres。验收默认低副本，避免 verify 打爆主机 CPU。

## 一键启动

```sh
# Repository root; Docker is required:
cp deploy/cluster-web/.env.example deploy/cluster-web/.env
DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
  docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build
# Open PUBLIC_URL (default http://127.0.0.1:8080/) with ?token= from the logs.
```

多 API 容器（上限 2）：

```sh
docker compose -f deploy/cluster-web/docker-compose.yml --env-file deploy/cluster-web/.env up --build --scale api=2
```

无 Docker 时仍可用进程树（S46 路径）：

`dsh up` 将 SIGINT 与 SIGTERM 转发给 supervisor，并在进程树及其输出流关闭后返回。

```sh
pnpm dsh up --edge-port 8080 --api-replicas 1 --runner-replicas 0 --skip-overlays --skip-runners
```

## 拓扑

| 服务 | 绑定 | 说明 |
|------|------|------|
| frontend / edge | `0.0.0.0:EDGE_PORT` | 唯一公网监听；`/`+`/plugins`→shell；`/api`→`api:FORWARD` |
| frontend / shell | `127.0.0.1:SHELL_PORT` | SPA + `/?token=` 换票 |
| api / forwarder | `0.0.0.0:API_FORWARD_PORT`（仅 compose 网） | 转发到本容器 loopback dsh |
| api / dsh | `127.0.0.1:API_LOOPBACK_PORT` | `--api-only`；不绑 `0.0.0.0` |
| postgres | compose 服务 | 设置 `DATABASE_URL` 时供 api 使用 |

## 外仓前端契约

同 [公开部署](../../docs/user/guide/public-deployments.zh.md)：单 origin；`/api`→API 池；等价 boot 与 token 换票。

## 验收 CPU 约束

| 旋钮 | 冒烟默认 | 硬上限 |
|------|----------|--------|
| `api` scale / `API_REPLICAS` | `1` | `2` |

## 文件

| 路径 | 职责 |
|------|------|
| `docker-compose.yml` | postgres + frontend + api |
| `frontend.mts` / `api.mts` | 容器入口 |
| `forward.mts` | API 内网转发 |
| `edge.mts` / `upstream.mts` | 同域反代 |
| `supervise.mts` | 无 Docker 进程树（S46） |

镜像通过 Docker `CMD` 默认启动 `supervise.mts`；Compose 将其替换为专用的 frontend 或 API 入口。SMOKE-core-24 检查各容器的 PID 1 命令，并验证 shell 签发的 cookie 能通过 API 路由认证。

## Helm

Helm chart 将相同的 frontend/api 分离拓扑投影到 Kubernetes。镜像准备与 `apiReplicas` 扩缩容见 [chart/README.zh.md](chart/README.zh.md)。

# delta — core-01-feature-design.md（变更 20261030-1651-cluster-web-independent-launch）

## MODIFIED — S46: 同域前后端分离（API-only + shell）— 交互规格（运维面）

**入口**：`deploy/cluster-web`（compose / supervise / `pnpm run cluster-web:up` / Helm）

**信息架构**：无产品 UI 变更（`ui_impact: false`）。运维面交付物：

1. **三分流 edge**：唯一公网监听；`STATIC_UPSTREAM` → shell；`API_UPSTREAMS` → API 池；`/api`（及 `/api/*`）轮询 API；`/`、静态资源与 **`/plugins`** 走 shell；保留浏览器 `Host` 与 WebSocket Upgrade。
2. **shell**：`dsh --profile web` + `serveFrontend: true`；负责 `window.__DSH_BOOT__` 注入、`GET /?token=` 换 cookie、插件客户端脚本；可与 API 共用 `$DSH_HOME` 凭证目录。
3. **API-only 副本**：`dsh --profile cluster-web-api`（bundle 置 `serveFrontend: false`，Postgres 持久化/流中继读 `DATABASE_URL`；无 Postgres 时附加 `overlays/no-postgres.patch.yml` 调用时补丁）；`--host 127.0.0.1`；共享 `$DSH_HOME` 使 `browser-session` cookie 跨副本互认。
4. **外仓替换契约**：外仓前端替换 shell 时必须 (a) 与 API 同浏览器 origin（同域反代）；(b) 提供等价 boot 注入与 `GET /?token=` 换票（或后续立项的 bootstrap 路径）；(c) `/plugins` 同源可达。不做跨域 CORS。
5. **低副本默认**：smoke 默认 shell=1、API=1、RUNNER=0；supervise 硬上限 API/RUNNER ≤ 2。

**验收**：SMOKE-core-23；串行；CPU ≤ `cpuThresholdPercent`。

## MODIFIED — S47: 同域前后端双容器 + API 容器级副本 — 交互规格（运维面）

**入口**：`deploy/cluster-web`（Compose 一等；Helm 对齐；`pnpm run cluster-web:up` 进程树为非 Docker 路径）

**信息架构**：无产品 UI 变更（`ui_impact: false`）。运维面交付物：

1. **frontend 容器**：公网 **edge**（`0.0.0.0:EDGE_PORT`，唯一对外端口）+ **shell**（`127.0.0.1:SHELL_PORT`，`dsh --profile web`，`serveFrontend: true`）；`STATIC_UPSTREAM` 指向本容器 shell；`API_UPSTREAMS` 指向 compose 服务名 `api:API_FORWARD_PORT`（Docker 内嵌 DNS RR）或显式多地址。`EDGE_PORT` 同时决定宿主发布端口与容器内监听端口。
2. **api 容器（可 scale）**：每副本一容器；内含 **API-only dsh**（`dsh --profile cluster-web-api`，`--host 127.0.0.1`，bundle 置 `serveFrontend: false`）+ **内网 HTTP forwarder**（`0.0.0.0:API_FORWARD_PORT` → 本机 loopback dsh）。**不**放开 `dsh --host 0.0.0.0`。
3. **共享 `$DSH_HOME` volume**：frontend 与全部 api 副本挂载同一目录，保证 cookie 跨 api 容器互认。
4. **容器级副本**：Compose `deploy.replicas` / `scale`（硬上限 2）；`docker compose ps` 可见多个 `api-*` 容器。
5. **与 S46 关系**：S46 定义同域逻辑分流与 API-only 契约；S47 将 Compose 一等路径落实为双容器 + 容器级 API 副本。外仓替换 shell 契约同 S46。

**验收**：SMOKE-core-24；串行；CPU ≤ `cpuThresholdPercent`。

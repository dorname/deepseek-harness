# delta — core-01-feature-design.md（变更 cluster-web-fe-be-containers）

## ADDED — S47 交互规格（运维面）

### S47: 同域前后端双容器 + API 容器级副本 — 交互规格（运维面）

**入口**：`deploy/cluster-web`（Compose 一等；Helm 对齐；裸机/`dsh up` 进程树可为非 Docker 路径）

**信息架构**：无产品 UI 变更（`ui_impact: false`）。运维面交付物：

1. **frontend 容器**：公网 **edge**（`0.0.0.0:EDGE_PORT`，唯一对外端口）+ **shell**（`127.0.0.1:SHELL_PORT`，`serveFrontend: true`）；`STATIC_UPSTREAM` 指向本容器 shell；`API_UPSTREAMS` 指向 compose 服务名 `api:API_FORWARD_PORT`（Docker 内嵌 DNS RR）或显式多地址。
2. **api 容器（可 scale）**：每副本一容器；内含 **API-only dsh**（`--host 127.0.0.1`，`serveFrontend: false`）+ **内网 HTTP forwarder**（`0.0.0.0:API_FORWARD_PORT` → 本机 loopback dsh）。**不**放开 `dsh --host 0.0.0.0`。
3. **共享 `$DSH_HOME` volume**：frontend 与全部 api 副本挂载同一目录，保证 cookie 跨 api 容器互认。
4. **容器级副本**：Compose `deploy.replicas` / `scale`（硬上限 2）；`docker compose ps` 可见多个 `api-*` 容器。
5. **与 S46 关系**：S46 定义同域逻辑分流与 API-only 契约；S47 将 Compose 一等路径落实为双容器 + 容器级 API 副本。外仓替换 shell 契约同 S46。

**验收**：SMOKE-core-24；串行；CPU ≤ `cpuThresholdPercent`。

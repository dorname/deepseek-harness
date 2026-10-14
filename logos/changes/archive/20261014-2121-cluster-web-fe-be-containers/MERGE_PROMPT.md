# 合并指令

## 变更提案
- 提案名称：cluster-web-fe-be-containers
- 提案目录：logos/changes/cluster-web-fe-be-containers/

## 提案内容

# 变更提案：cluster-web-fe-be-containers（Compose 前后端双容器 + API 容器级副本）

> module: core | created: 2026-10-13

## 变更原因

用户确认目标与 S46 落地不一致：前后端须落在**两个 Docker 容器**中，且多后端须在 Docker 环境中体现为**容器级副本**（而非同一 `cluster` 容器内多进程）。S46 已交付同域分流与 `serveFrontend`/API-only，但 Compose 仍为单容器进程树，且提案明确裁剪了「不把 API 与 edge 拆成独立容器」。本变更在保留同域、不放开 `dsh --host 0.0.0.0` 的前提下，将拓扑改为 `frontend` + `api`（scale）+ 共享 `DSH_HOME` volume。

## 变更类型

设计级 + 部署级 + 代码级（Compose/supervise/edge/Helm/smoke；新增场景 S47）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（新增 S47；场景总览表追加一行；`scenario_counter.next_id` → 48；S46 部署形态注明「逻辑分流，物理仍可同容器」与 S47 关系）
- 影响的功能规格：`core-01-feature-design.md`（S47 运维面：双容器、公网 edge 在 frontend、API 内网转发、容器级 scale）
- 影响的业务场景：S47（新增）；S46 保留（逻辑契约）；S43 Compose 一键语义升级为双服务拓扑（部署方案 MODIFIED，不删旧场景）
- 影响的部署方案：`core-01-deployment-plan.md`（MODIFIED：frontend/api/postgres；内网 forwarder；共享 volume；API `deploy.replicas`/`scale`）
- 影响的系统地图：`core-system-map.md`（§12.9 或并列：双容器同域拓扑）
- 影响的 API：无新公开 HTTP 端点
- 影响的 DB 表：无
- 影响的编排测试：`core-S47-test-cases.md`（新增 UT/ST）
- 影响的 smoke 测试：`core-smoke-test-cases.md`（追加 SMOKE-core-24；守恒携带既有行；SMOKE-core-20/23 说明对齐双容器或保留 supervise 路径）

## 部署影响

- 是否需要部署：是
- 部署原因：SMOKE-core-24 需真实拉起 frontend + 可 scale 的 api 容器，经同域入口完成 token→cookie→`/api`，并断言 `docker compose ps` 可见独立 frontend/api（副本≥2 时可见多个 api 容器）
- 影响环境：本地 staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（回退到 S46 单 `cluster` 进程树 compose；删除本变更的 frontend/api 拆分即可）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

浏览器 GUI 交互不变；仅 Docker 服务拆分与副本呈现变化。

## 变更概述

1. **Compose 拓扑 A**：`frontend` 容器 = 公网 **edge**（`0.0.0.0:EDGE_PORT`）+ **shell**（loopback，`serveFrontend: true`）；`api` 服务 = 每副本一容器，内含 **API-only dsh**（loopback）+ **内网 HTTP forwarder**（监听 Docker 网络 `0.0.0.0:API_FORWARD_PORT` → 本机 loopback dsh，**不**把 dsh 直接绑非 loopback）；可选 `postgres`。浏览器只访问 frontend 的 `PUBLIC_URL`。
2. **容器级 API 副本**：`api` 用 Compose `deploy.replicas` / `scale`（验收硬上限 2）；frontend edge 的 `API_UPSTREAMS` 指向 compose 服务名（Docker 内嵌 DNS RR）或显式多地址；Desktop/`docker compose ps` 可见多个 `api` 容器。
3. **共享 `$DSH_HOME`**：frontend 与全部 api 副本挂载同一 volume，保证 `browser-session` cookie 跨 API 容器互认。
4. **范围裁剪**：仍不放开 `dsh --host 0.0.0.0`；不做跨域 CORS；本期不做 `/api/auth/bootstrap`；裸机/`dsh up` 进程树可保留为非 Docker 路径，但 Compose 一等路径改为双容器。
5. **Helm**：对齐 frontend Deployment + api Deployment（replicas）+ 共享 PVC/空目录策略文档化。
6. **SMOKE-core-24**：compose up → 断言 frontend/api 服务分离 →（副本=2）断言 ≥2 个 api 容器 → token/cookie/`/api` → SIGTERM/compose down；串行；CPU ≤ 阈值。

## 验收资源约束（本提案全部 ST/SMOKE）

- 副本：`API` 容器副本 ≤2；smoke 默认可先 1，诊断多副本时用 2；`RUNNER` 默认 0。
- 执行：冒烟串行；不与其他 smoke 并行叠跑超量拓扑。
- CPU：峰值 ≤ `cpuThresholdPercent`（默认 80）。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/cluster-web-fe-be-containers/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/cluster-web-fe-be-containers/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/cluster-web-fe-be-containers/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/cluster-web-fe-be-containers/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/test/core-S47-test-cases.md

- Delta 文件：`logos/changes/cluster-web-fe-be-containers/deltas/test/core-S47-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/cluster-web-fe-be-containers/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(cluster-web-fe-be-containers): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive cluster-web-fe-be-containers`。

# 变更提案：cluster-web-compose（同域集群 Compose 一键启动 · P0）

> module: core | created: 2026-10-11

## 变更原因

用户目标为「同域一套前端连后端、可上 K8s」，并要求一键启动。既有能力已具备无状态后端集群与同域反代契约（`stateless-cluster-deployment` / `public-deployments`），但仓库缺少可执行的 Compose 拓扑与一键入口。本变更交付 P0：`deploy/cluster-web`（compose + env + 同域 edge + 进程监督）与低 CPU 串行冒烟。P1（`dsh up`）与 P2（K8s/Helm）另立提案，顺序推进。

## 变更类型

设计级 + 代码级（部署拓扑交付物 + 监督/edge 脚本 + smoke；新增场景 S43）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（新增 S43：同域 cluster-web Compose 一键启动；5.3 不做清单不改 Operator 裁剪）
- 影响的功能规格：`core-01-feature-design.md`（S43 交互/运维规格）
- 影响的业务场景：S43（新增）
- 影响的部署方案：`core-01-deployment-plan.md`（MODIFIED：cluster-web Compose 拓扑、环境变量、验收 CPU 约束）
- 影响的系统地图：`core-system-map.md`（§12.6 或并列小节：cluster-web 一键拓扑）
- 影响的 API：无
- 影响的 DB 表：无（复用既有共享 Postgres 后端）
- 影响的编排测试：`core-S43-test-cases.md`（新增；验收串行、副本上限、CPU 阈值）
- 影响的 smoke 测试：`core-smoke-test-cases.md`（追加 SMOKE-core-20）

## 部署影响

- 是否需要部署：是
- 部署原因：SMOKE-core-20 需真实拉起 edge+api（可选 postgres）并经同域入口探测；本机无 Docker 时用进程监督等价拓扑验收
- 影响环境：本地 staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：否（纯新增交付物；删除 `deploy/cluster-web` 即回退）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

交付同域 cluster-web **Compose 一键**形态：

1. **`deploy/cluster-web/`**：`docker-compose.yml`（postgres + 监督容器）、`Dockerfile`、`.env.example`、api/runner overlay 模板、Node edge（同域反代，保留 `Host`、转发 `/api` 与 WebSocket）、`supervise` 在单容器/单主机内将 api/runner 绑 loopback（遵守「禁止 `--host 0.0.0.0`」；仅 edge 对外）。
2. **验收 CPU 约束（强制）**：staging/smoke 默认 `API_REPLICAS=1`、`RUNNER_REPLICAS=1`（硬上限 2）；冒烟**串行**；全程 `cpuThresholdPercent`（`scripts/fleet-staging/staging.config.json`）监控，超阈 fail；禁止并行拉起超量进程或跑全量 suite 充当 smoke。
3. **SMOKE-core-20**：无 Docker 时走 supervise 进程树；有 Docker 时可选 `compose up`。断言唯一 origin 下 HTTP 200，SIGTERM 后子树退出。

范围裁剪：不引入 `dsh up` CLI（P1）；不提交 Helm/K8s 清单（P2）；不做 Operator/CRD；不做跨域 CDN 前端。

## 验收资源约束（本提案全部 ST/SMOKE）

- 副本：`API_REPLICAS≤2` 且 `RUNNER_REPLICAS≤2`；smoke 默认均为 1。
- 执行：冒烟用例串行；不与其他 smoke 并行叠跑超量拓扑。
- CPU：峰值 ≤ `cpuThresholdPercent`（默认 80）；超阈视为环境违规，先降副本再继续，不得带违规定论。

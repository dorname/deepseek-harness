# 变更提案：cluster-web-fe-split（同域前后端分离 · API-only + shell）

> module: core | created: 2026-10-12

## 变更原因

用户确认前后端需支持分离：前端将独立成外仓单独部署。现有 cluster-web（S43–S45）仍把 `/` 打到完整 `dsh web`（自带 SPA），与「同域反代：`/`→前端、`/api`→后端副本」的编排器无关部署原则不一致，也无法关闭自带静态前端。本变更交付同域分流拓扑、`serveFrontend` API-only，以及外仓前端接入契约；不做跨域 CORS。

## 变更类型

设计级 + 代码级（部署拓扑演进 + web-app Config + supervise/edge/Helm + smoke；新增场景 S46）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（新增 S46：同域前后端分离；场景总览表追加一行；`scenario_counter.next_id` → 47）
- 影响的功能规格：`core-01-feature-design.md`（S46 运维/同域分流规格；外仓契约摘要）
- 影响的业务场景：S46（新增）；S43–S45 主路径语义升级为「shell + API-only」（部署方案 MODIFIED，不删旧场景）
- 影响的部署方案：`core-01-deployment-plan.md`（MODIFIED：shell/API-only/edge 三分流；共享 `DSH_HOME` cookie 密钥；外仓替换契约）
- 影响的系统地图：`core-system-map.md`（§12.7 或并列小节：前后端同域分离）
- 影响的 API：无新公开 HTTP 端点（token 仍走 shell `GET /?token=`；本期不做 `/api/auth/bootstrap`）
- 影响的 DB 表：无
- 影响的编排测试：`core-S46-test-cases.md`（新增 UT/ST；CPU/副本约束同 S43）
- 影响的 smoke 测试：`core-smoke-test-cases.md`（追加 SMOKE-core-23；守恒携带既有行）

## 部署影响

- 是否需要部署：是
- 部署原因：SMOKE-core-23 需真实拉起 shell + API-only + edge，经同域入口完成 token→cookie→`/api` 探测
- 影响环境：本地 staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（回退到「单进程树仅 API 提供 `/`」的旧 supervise/edge 行为；删除本变更 overlay/`serveFrontend: false` 即可）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

浏览器 GUI 交互不变；仅部署拓扑与配置契约变化（同域、相对路径 `/api`）。

## 变更概述

1. **`serveFrontend`（默认 true）**：`@deepseek-ai/dsh-web-app` 可关闭 `frontend-static`；API 副本 overlay 设 `false`；可选 CLI `--api-only`。
2. **cluster-web 三分流**：supervise 起 **shell**（`serveFrontend: true`，承担 index 注入、`/?token=` 换 cookie、`/plugins`）+ **N×API-only** + **edge**（`STATIC_UPSTREAM` + `API_UPSTREAMS`；`/api` 轮询，其余走 shell）。共享 `$DSH_HOME` 使 `browser-session` 签名跨 API 互认。
3. **外仓契约（文档）**：替换 shell 的外仓前端必须同域；提供等价 boot 注入与 token 换票；`/plugins` 同源可达。本期 shell 为本仓占位，不做跨域 CDN。
4. **Helm**：对齐 shell/edge 分流语义；验收默认仍低副本。
5. **SMOKE-core-23**：token→303+cookie→HTML 含 `__DSH_BOOT__`；无 cookie `/api`→401；串行；CPU ≤ 阈值。

范围裁剪：不做跨域 CORS / 改 SameSite；不放开 `dsh --host 0.0.0.0`；不把 API 与 edge 拆成不共享网络命名空间的独立容器；本期不做 `/api/auth/bootstrap`。

## 验收资源约束（本提案全部 ST/SMOKE）

- 副本：`API_REPLICAS≤2` 且 `RUNNER_REPLICAS≤2`；smoke 默认 API=1、RUNNER=0，另起 1×shell。
- 执行：冒烟用例串行；不与其他 smoke 并行叠跑超量拓扑。
- CPU：峰值 ≤ `cpuThresholdPercent`（默认 80）；超阈视为环境违规。

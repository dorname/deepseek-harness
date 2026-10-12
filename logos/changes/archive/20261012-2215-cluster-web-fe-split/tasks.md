# 实现任务

## [delta] 规格变更

- [x] 产出 delta：`deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S46；场景总览表追加一行；`logos-project.yaml` `scenario_counter.next_id` → 47
- [x] 产出 delta：`deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — S46 运维/同域分流与外仓契约规格
- [x] 产出 delta：`deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 同域前后端分离拓扑小节
- [x] 产出 delta：`deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — shell + API-only + edge；共享 DSH_HOME；外仓替换指引
- [x] 产出 delta：`deltas/test/core-S46-test-cases.md` — UT/ST + 资源约束
- [x] 产出 delta：`deltas/test/smoke/core-smoke-test-cases.md` — SMOKE-core-23（整表守恒）

## [code] 代码实现

> 删后续自检：六维约 11 分。曾试拆「serveFrontend / edge 分流 / supervise+smoke」三片，但全量 `openlogos verify` 以 S46 全部 UT/ST 为分母，任一片落单都会因其余 ID 无结果红灯；能力又互相咬死（API-only 无 shell/edge 不可观察，edge 无 shell 无 token 换票）。故评分达大任务但不可安全垂直拆分，**显式单片**。

- [x] 单切片：落地同域前后端分离端到端——`web-app` `serveFrontend`（含可选 `--api-only`）、api/shell overlay、共享 `DSH_HOME`、edge `STATIC_UPSTREAM`+`API_UPSTREAMS`（含 `/plugins`）、supervise 起 shell+API-only+edge、Helm 对齐、cluster-web/public-deployments 外仓契约文档、`scripts/smoke-cluster-web-fe-split.ts`（或扩展 compose smoke）写入 smoke-results.jsonl 并接入 smoke runner；同步 UT/ST + reporter（覆盖 UT-S46-01..04、ST-S46-01..03、SMOKE-core-23）

## [deploy] 部署任务

- [x] 跑 SMOKE-core-23（supervise 或 compose：shell + API-only + edge；记录 token/cookie/API 与 CPU 峰值）；写入 smoke-results.jsonl

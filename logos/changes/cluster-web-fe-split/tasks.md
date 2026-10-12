# 实现任务

## [delta] 规格变更

- [x] 产出 delta：`deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S46；场景总览表追加一行；`logos-project.yaml` `scenario_counter.next_id` → 47
- [x] 产出 delta：`deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — S46 运维/同域分流与外仓契约规格
- [x] 产出 delta：`deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 同域前后端分离拓扑小节
- [x] 产出 delta：`deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — shell + API-only + edge；共享 DSH_HOME；外仓替换指引
- [x] 产出 delta：`deltas/test/core-S46-test-cases.md` — UT/ST + 资源约束
- [x] 产出 delta：`deltas/test/smoke/core-smoke-test-cases.md` — SMOKE-core-23（整表守恒）

## [code] 代码实现

（本段在 plan 段留空：本提案需要代码实现，但 `[code]` 切片由 merge 后的 `slice-planner` 基于已合并规格和真实 UT/ST/SMOKE ID 统一规划。此处仅保留 `## [code]` 标题，勿提前填写切片项。）

## [deploy] 部署任务

- [ ] 跑 SMOKE-core-23（supervise 或 compose：shell + API-only + edge；记录 token/cookie/API 与 CPU 峰值）；写入 smoke-results.jsonl

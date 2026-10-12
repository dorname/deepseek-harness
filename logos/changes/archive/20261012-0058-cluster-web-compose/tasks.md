# 实现任务

## [delta] 规格变更

- [x] 产出 delta：`deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S43；场景总览表追加一行；`scenario_counter.next_id` → 44
- [x] 产出 delta：`deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — S43 运维/同域一键规格
- [x] 产出 delta：`deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — cluster-web Compose 拓扑小节
- [x] 产出 delta：`deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — Compose 拓扑、env、CPU 验收约束
- [x] 产出 delta：`deltas/test/core-S43-test-cases.md` — UT/ST + 资源约束
- [x] 产出 delta：`deltas/test/smoke/core-smoke-test-cases.md` — SMOKE-core-20（整表守恒）

## [code] 代码实现

- [x] `deploy/cluster-web/`：compose、Dockerfile、env 示例、overlay 模板、edge、supervise、README（中英）
- [x] `scripts/smoke-cluster-web-compose.ts`：串行、副本=1、CPU 监控、JSONL 账本
- [x] 根/`package.json` 可选脚本入口（若需要）

## [deploy] 部署任务

- [x] 跑 SMOKE-core-20（无 Docker 走 supervise；记录 CPU 峰值）；写入 smoke-results.jsonl

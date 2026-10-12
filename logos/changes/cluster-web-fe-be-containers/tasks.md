# 实现任务

## [delta] 规格变更

- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S47；场景总览表追加；说明 S46 与 S47 关系；`scenario_counter.next_id` → 48（merge 时同步）
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — S47 运维/双容器交互规格
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — §12.9 双容器同域拓扑
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — Compose frontend/api/postgres；forwarder；共享 DSH_HOME；容器级 scale
- [x] 产出 delta 文件到 `deltas/test/core-S47-test-cases.md` — UT/ST（路由、forwarder、scale 可见性、共享 home、CPU/副本帽）
- [x] 产出 delta 文件到 `deltas/test/smoke/core-smoke-test-cases.md` — 追加 SMOKE-core-24；守恒携带既有 smoke 行

## [code] 代码实现

> 删后续自检：评分≈10（跨 compose/forwarder/Helm/smoke），但 frontend↔api↔共享 volume↔edge DNS 互相咬死，垂直拆片过不了全量 verify，故单片。

- [x] 单切片：Compose 拆为 `frontend`（edge+shell）与可 scale 的 `api`（loopback API-only + 内网 forwarder）+ 共享 `DSH_HOME` volume；更新 supervise/entrypoint/Helm/README；实现 UT-S47-01..03、ST-S47-01..04 reporter 与 `scripts/smoke-cluster-web-fe-be-containers.ts`（SMOKE-core-24），接入 smoke runner

## [deploy] 部署任务

- [ ] 按部署方案在本地 staging 拉起双容器 compose（含可选 API scale=2）
- [ ] 确认共享 DSH_HOME volume、公网仅 frontend、回滚到单 cluster 进程树的预案

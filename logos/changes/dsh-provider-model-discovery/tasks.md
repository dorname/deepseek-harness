# 实现任务

## [delta] 规格变更
- [x] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S48 场景、验收条件及 S03/S20/S26 关联。
- [x] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 更新 ACP 结构并新增 S48 目录、错误和交互规格。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 更新模型域动态发现能力及组件职责。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 更新 ACP 动态目录与错误发布链路。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S48-provider-model-discovery.md` — 新增 S48 发现、缓存、失败、刷新和精确模型请求时序。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/acp-S01-network-session-lifecycle.md` — 关联 S48 的 session/new、模型切换和错误行为。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 更新发布物、凭据、配置迁移、回滚和部署后检查。
- [x] 产出 `deltas/test/core-S48-test-cases.md` — 新增 S48 UT/ST 用例及 AC 追溯。
- [x] 产出 `deltas/test/smoke/core-smoke-test-cases.md` — 新增真实动态目录与精确模型 ID 推理 smoke。

## [code] 代码实现
（本段在 plan 段留空：本提案需要代码实现，但 `[code]` 切片由 merge 后的 `slice-planner` 基于已合并规格和真实 UT/ST ID 统一规划。此处仅保留 `## [code]` 标题，勿提前填写切片项。切片范围必须覆盖 S48 时序指定的实现包、业务代码与对应 UT/ST/reporter、keyless ACP 快照、受影响包的中英文 README/JSDoc，以及 `docs/upgrade-guide/v0.2.1-alpha.1/` 下的配置与 ACP 行为升级指南。）

## [deploy] 部署任务
- [ ] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。
- [ ] 使用既有 Secret 配置真实供应商端点，确认服务启动、动态目录可用及上一版发布物回滚路径。

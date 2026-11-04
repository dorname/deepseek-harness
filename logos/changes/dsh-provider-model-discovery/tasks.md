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
> 删后续自检：评分 10（跨模块、异步生命周期、9+ 用例、安全与部署影响）。动态 provider 若缺少 ACP 同步改造会继续吞错并补回失效模型；ACP 若先于真实目录落地则没有端到端动态能力，两种拆法都不能独立通过全量 verify，故保留单切片。
- [x] 单切片：实现 DeepSeek 动态目录、人工覆盖、成功缓存/singleflight/取消/dispose、LLM 信号贯通与 ACP options/原子切换；交付真实 Loader 与 ACP ST、keyless 快照、共享 OpenLogos reporter、实现清单、受影响包中英文 README/JSDoc 和升级指南；实现 `scripts/smoke-deepseek-discovery.ts` 及 `smoke-results.jsonl` 记录并接入统一 smoke dispatcher，完成 smoke 覆盖预检（覆盖 UT-S48-01、UT-S48-02、UT-S48-03、UT-S48-04、UT-S48-05、UT-S48-06、UT-S48-07、ST-S48-01、ST-S48-02、SMOKE-core-25）

## [deploy] 部署任务
- [ ] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。
- [ ] 使用既有 Secret 配置真实供应商端点，确认服务启动、动态目录可用及上一版发布物回滚路径。

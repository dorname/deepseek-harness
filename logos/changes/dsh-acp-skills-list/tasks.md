# 实现任务

## [delta] 规格变更
- [ ] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S50 场景、验收条件及 S03/S49 关联。
- [ ] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 §10 技能清单交互规格与 ACP 扩展方法面说明。
- [ ] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 新增技能目录 ACP 入口与组件职责。
- [ ] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 新增 skills_list 方法面、注册与错误传播链路。
- [ ] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S50-acp-skills-list.md` — 新增 S50 枚举解析链、时序与边界。
- [ ] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 更新发布物、部署后检查与回滚说明。
- [ ] 产出 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md` — 更新 staging 验证与技能枚举检查。
- [ ] 产出 `deltas/test/core-S50-test-cases.md` — 新增 S50 UT/ST 用例及 AC 追溯。
- [ ] 产出 `deltas/test/smoke/acp-network-smoke-test-cases.md` — 新增真实技能枚举冒烟 SMOKE-acp-network-04。

## [code] 代码实现
- [ ] 实现单切片：bridge 扩展方法 `session/skills_list`（SDK 扩展方法注册、参数校验、live agent 预设作用域 → 全局注册表回退解析链、双旗标无过滤映射、registry 缺失 fail-loud）；`packages/acp` 新增 `@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-agent-preset-registry` peer/dev 依赖（类型与解析链所需）；交付 UT-S50-01..05、ST-S50-01、keyless 快照、受影响包中英文 README/JSDoc 与 `docs/upgrade-guide/<发布版本>/acp-skills-list/` 升级指南；实现 SMOKE-acp-network-04 并接入统一 smoke dispatcher，完成 smoke 覆盖预检（覆盖 UT-S50-01、UT-S50-02、UT-S50-03、UT-S50-04、UT-S50-05、ST-S50-01、SMOKE-acp-network-04）

## [deploy] 部署任务
- [ ] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。
- [ ] 验证真实 ACP 会话技能枚举往返（清单与已知目录一致、双旗标语义、未知会话错误、registry 缺失行为），并回归既有 prompt/resume 与 S49 审批策略路径，确认上一版发布物回滚路径。

# 实现任务

## [delta] 规格变更
- [x] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S49 场景、验收条件及 S03/S21/S22 关联。
- [x] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 S49 审批策略配置交互规格与 ACP config option 面。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 更新审批策略域（always 档、预设打包）与组件职责。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 更新 ACP config option 面、广告与错误传播链路。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S49-acp-permission-policy.md` — 新增 S49 策略配置、always 触发、应答结算与 resume 恢复时序。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/acp-S02-network-permission-prompt.md` — 关联 S49 策略档对权限回环的影响。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 更新发布物、配置迁移、回滚和部署后检查。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md` — 更新 ACP 网络面的发布与部署后检查。
- [x] 产出 `deltas/test/core-S49-test-cases.md` — 新增 S49 UT/ST 用例及 AC 追溯。
- [x] 产出 `deltas/test/smoke/acp-network-smoke-test-cases.md` — 新增真实审批往返冒烟 SMOKE-acp-network-03。

## [deploy] 部署任务
- [ ] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。
- [ ] 验证 ACP 会话审批策略配置、`always` 审批往返与 reject-once 分支，并回归 `permission_preset` 预设应用，确认服务启动、既有会话回归及上一版发布物回滚路径。

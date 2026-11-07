# 实现任务

## [delta] 规格变更
- [ ] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S51 场景、验收条件及 S03/S11/S49/S50 关联。
- [ ] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 §11 计划模式 ACP 交互规格（modes 词表、set_mode 时序契约、plan-review optionId 映射）。
- [ ] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 新增 §16 计划模式 ACP 入口与组件职责。
- [ ] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 新增 set_mode 方法面、modes 广告、current_mode_update 推送与 plan-review 复用审批通道链路。
- [ ] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S51-acp-plan-mode.md` — 新增 S51 模式面解析、评审转换、时序与边界。
- [ ] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 更新发布物、部署后检查与回滚说明。
- [ ] 产出 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md` — 更新 staging 验证与模式面检查。
- [ ] 产出 `deltas/test/core-S51-test-cases.md` — 新增 S51 UT/ST 用例及 AC 追溯。
- [ ] 产出 `deltas/test/smoke/acp-network-smoke-test-cases.md` — 新增真实模式面冒烟 SMOKE-acp-network-05。

## [code] 代码实现
- [ ] 实现单切片：bridge 注册标准方法 `session/set_mode`（未知会话/未知 modeId/plan-mode 缺席/会话关闭四错误分支）；`session/new` / `session/resume` 响应广告可选 `modes`（plan/normal 二值、已提交状态、插件缺席省略）；`AcpSession.onSessionEvent` 新增 `plan/mode` → `current_mode_update` 派生推送；bridge 连接上注册 `user-questions/request` 瀑布应答者（plan-review intent → `session/request_permission` approve/keep-planning 映射、drainUpdates 排序、cancelled → ASK_CANCELLED、其余 next()）；交付 UT-S51-01..06、ST-S51-01、keyless 快照、受影响包中英文 README/JSDoc 与 `docs/upgrade-guide/<发布版本>/acp-plan-mode/` 升级指南；实现 SMOKE-acp-network-05 并接入统一 smoke dispatcher，完成 smoke 覆盖预检。

## [deploy] 部署任务
- [ ] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。（人工确认点：需用户明确授权后执行）
- [ ] 验证真实 ACP 会话模式面往返（modes 广告、set_mode 提交与 current_mode_update 时序、未知 modeId 错误、resume 恢复），并回归既有 prompt/resume、S49 审批策略与 S50 技能枚举路径，确认上一版发布物回滚路径。

# 实现任务

## [delta] 规格变更
- [ ] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S52 场景、验收条件及 S03/S15/S49/S50/S51 关联。
- [ ] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 §12 会话压缩 ACP 交互规格（同步方法、六失败码 data.code 词表、capability 门控通知）。
- [ ] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 新增 §17 压缩 ACP 入口与组件职责。
- [ ] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 新增 session/compact 方法面、错误映射与通知派发链路。
- [ ] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S52-acp-compaction.md` — 新增 S52 方法语义、通知派生、时序与边界。
- [ ] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 更新发布物、部署后检查与回滚说明。
- [ ] 产出 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md` — 更新 staging 验证与压缩面检查。
- [ ] 产出 `deltas/test/core-S52-test-cases.md` — 新增 S52 UT/ST 用例及 AC 追溯。
- [ ] 产出 `deltas/test/smoke/acp-network-smoke-test-cases.md` — 新增真实压缩冒烟 SMOKE-acp-network-06。

## [code] 代码实现
- [ ] 实现单切片：bridge 扩展方法 `session/compact`（SDK 扩展方法注册、参数校验、`ctx.get('compaction')` 缺席 fail-loud、bridge 自铸 CommandId 记入三元组 sourceCommandId、`compactNow` 全包装语义、六失败码经 internal error data.code 携带并复用 /compact 人类文本、caller 取消 → cancelled、`{ result: null }` 无可压缩历史）；initialize handler 捕获 clientCapabilities，`session.compaction` 声明时 `AcpSession.onSessionEvent` 派生 `compaction_update`（start → in_progress、end 无错 → completed 含前置 summary 事件内容块、end 带错 → failed）；交付 UT-S52-01..06、ST-S52-01、keyless 快照、受影响包中英文 README/JSDoc 与 `docs/upgrade-guide/<发布版本>/acp-compaction/` 升级指南；实现 SMOKE-acp-network-06 并接入统一 smoke dispatcher，完成 smoke 覆盖预检。

## [deploy] 部署任务
- [ ] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。（人工确认点：需用户明确授权后执行）
- [ ] 验证真实 ACP 会话压缩往返（真实模型产历史 → compact → 同步结果 → busy 竞态 → 错误分支 → resume 后摘要生效），声明/未声明 compaction 能力两客户端的通知面核对，并回归既有 prompt/resume、S49/S50/S51 路径，确认上一版发布物回滚路径。

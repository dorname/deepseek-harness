# 实现任务

## [delta] 规格变更
- [x] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S54 场景、验收条件及 S49/S51 关联。
- [x] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 §14 goal 完成授权经 ACP 规格（ask 路径、steer-back 见证回传、bridge 意图应答者、意图联合扩展、安全模型保持论证）。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 新增 §19 goal 授权面与组件职责。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 补记 goal-review 意图应答与 request_permission 词汇（协议方法零新增）。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S54-acp-goal-approval.md` — 新增 S54 授权时序、见证保持矩阵与边界。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 新增 §十六 发布物、staging 步骤与回滚注意。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md` — 新增 goal 授权卡 staging 验证与 dspm 部署指引。
- [x] 产出 `deltas/test/core-S54-test-cases.md` — 新增 S54 UT/ST 用例及 AC 追溯。
- [x] 产出 `deltas/test/smoke/acp-network-smoke-test-cases.md` — 新增 goal 授权卡冒烟 SMOKE-acp-network-08。

## [code] 代码实现
- [x] 实现单切片：`tool-goal` 的 `complete`/`blocked` 在 `completionAuthority` 拒绝且 `ctx.get('userQuestions')` 存在时先征求授权（问题指名 goal 标题与操作、选项 Authorize/Deny、intent `{kind:'goal-review', approve, goalId, callId?}`；无通道立即拒绝行为不变；admitted round 与既有 direct-human 通过路径永不征求）；Authorize 应答后 `agent.steer()` 注入源为 user 的授权用户消息（'next-step'、同开放回合内提交）并返回指向重调的结构化结果，模型重调经 direct-human 见证完成；Deny/`ASK_CANCELLED` 返回注明拒绝的既有权威拒绝。`AskUserQuestionIntent` 新增 `goal-review` tagged kind（呈现意图、协议不变；宿主内类型不跨 ACP wire，双 SDK 零改动）。ACP bridge 新增 goal-review 意图应答者（`user-questions/request` 瀑布、owned session 匹配、`session/request_permission` 承载选项词汇；plan-review 应答者与其余意图行为不变）。见证逻辑（`authority.ts`）、`GoalService`、`SessionEventMap`、Session format 零改动。交付 UT-S54-01..07（tool-goal ask/steer/deny/无通道/取消/既有授权路径回归/intent 联合与 wire 校验，含真实 Loader 组合与 HMR dispose 回归）、ST-S54-01（ACP 会话全链路：mock 模型未授权 complete → request_permission 卡 → Authorize → steer 落回合 → 重调完成 → 会话日志见证与完成事件）、SMOKE-acp-network-08 接入 protocol-smoke.ts 与统一 smoke dispatcher（本地通道全链路断言；staging 无交互握手按 skip 语义）、keyless recorded-session 快照新场景固定 steer 消息与工具结果文本（含 snapshot harness 应答支持）、中英 README + 升级指南三元组（版本号随发布期定）。

## [deploy] 部署任务
- [x] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。（人工确认点：用户已明确授权 2026-11-09；构建 355 artifacts @ `55b4971811`；SMOKE-acp-network-01..08 本地全过、staging 握手按 skip 语义记录；报告 `logos/resources/verify/s54-deployment-report.md`）
- [x] 验证 ACP 会话内 goal 授权卡往返（未授权调用 → request_permission → Authorize → steer 落回合 → 重调完成）、Deny/取消路径、无通道 fail-fast、既有 goal round 与 direct-human 路径回归、S49/S51/S03 回归，确认上一版发布物回滚路径（旧构建无 ask 行为，日志回读无损）。（人工确认点：用户已明确授权 2026-11-09；Gate 3.8 PASS 21/0/12 覆盖 100%、回归 11 文件/150 测试、回滚词汇核对 ⊆ `40d8ea8dd4`、Gate 3.6 复跑 PASS）

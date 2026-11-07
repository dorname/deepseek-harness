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

## [code] 代码实现
> 删后续自检：评分 11（跨模块、三档状态分发、ACP 兼容契约、9+ 用例、安全与部署影响、required-on-read 待验证假设），达大任务线。尝试垂直拆分均被删后续门证伪：「ask/never 策略面」片删后续后 UT-S49-02/06 与 SMOKE-acp-network-03 飘红（已合并测试规格将三档+预设+smoke 定义为 S49 验收整体）；「always 档」片与「preset 面」片共享 bridge option 分支与词表扩展，互为前向依赖；(b) 单独可观察但 (a) 全量 verify 无法独立通过。各部分咬死，不可安全垂直拆分，故单片。
- [x] 单切片：实现 ACP 审批策略配置入口——bridge `permission_policy`（ask/never/always）与 `permission_preset` option 分支、fail-loud 校验、configOptions 广告；`ApprovalPolicy` 新增 `always` 档；持久化按档分流（ask/never 落 `approval/policy`，payload 冻结于 format-4 词表；always 落新增普通事件类型 `approval/policy-always`，same-version 持久化记录 `docs/persistence-changes/2026-11-06-approval-policy-always-event`，旧构建按 required-on-read 拒开含该事件的日志）；pre-execute always 询问源路由进 serviceAsk；交付 UT-S49-01..07、ST-S49-01/02 与 keyless 快照、共享 OpenLogos reporter、受影响包中英文 README/JSDoc 与 `docs/upgrade-guide/<发布版本>/acp-permission-policy/` 升级指南；实现 SMOKE-acp-network-03（扩展 `packages/acp/acp-network/tests/smoke/protocol-smoke.ts`）、写 `smoke-results.jsonl` reporter 并接入统一 smoke dispatcher，完成 smoke 覆盖预检（覆盖 UT-S49-01、UT-S49-02、UT-S49-03、UT-S49-04、UT-S49-05、UT-S49-06、UT-S49-07、ST-S49-01、ST-S49-02、SMOKE-acp-network-03）

## [deploy] 部署任务
- [x] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。 — 本地 staging 等效环境（用户授权），`pnpm run build` 于源码 commit `da8e79a698`（0.2.1-alpha.1，355 client artifacts）；回滚基线 `fb8b38fa68`；部署报告 `logos/resources/verify/deployment-report.md`。
- [x] 验证 ACP 会话审批策略配置、`always` 审批往返与 reject-once 分支，并回归 `permission_preset` 预设应用，确认服务启动、既有会话回归及上一版发布物回滚路径。 — Gate 3.8 PASS（`openlogos smoke` 16/0/12 覆盖 100%），Gate 3.6 PASS（`openlogos verify` pre_run exit=0，205 用例 0 失败）；SMOKE-acp-network-01/02/03 真实 WebSocket 冒烟 PASS（always 往返 1131ms ≤ 5s 检查线）；S49 套件 7/7（UT-S49-05 覆盖 close→resume 折叠恢复，UT-S49-06 覆盖预设回归）；部署方案五项全部验证，详见部署报告。

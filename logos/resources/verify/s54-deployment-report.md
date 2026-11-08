# 部署报告：goal 完成授权经 ACP（dsh-acp-goal-approval）

> 提案：`dsh-acp-goal-approval`
> 时间：2026-11-09T00:20+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；ACP-over-network 真实 WebSocket 往返走本地 goal 组合；staging 交互握手按方案 skip 语义记录，永不报 PASS）
> 发布物源码 commit：`55b4971811`（实现链 `ed600addfd` merge → `ace2b15135` [code] → `df47b871b2` verify 证据 → `55b4971811` dispatcher ledger fix；版本 0.2.1-alpha.1）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `55b4971811`） | 成功（355 client artifacts） |
| SMOKE-acp-network-01..08（官方 dispatcher，临时账本） | PASS ×8（08 为本变更新增 goal 授权卡往返面：未授权 complete → `session/request_permission` 携带 approve/deny · allow_once/reject_once · Authorize/Deny 词汇且随行 tool_call 指名完成调用；Deny → goal 保持 active 无注入；Authorize → 注入源 user 授权消息、模型重调完成）；staging handshake skipped（无 Ready deploy/creds），按 skip 语义记录，未报 PASS |
| S54 + S49/S50/S51/S52/S03 回归套件（reporter 账本） | 11 文件 / 150 测试全部通过，30 账本记录全 pass（UT-S54-01..07 与 ST-S54-01 由 tool-goal.spec 17 例 + goal-approval.spec 6 例承载；S49 approval/permission-control/permission-roundtrip、S50 skill-list、S51 plan-mode、S52 compaction、S03 network/multi-provider、user-questions 面） |
| 回滚路径确认（零新增持久化事件类型） | 程序化核对：S54 快照场景 `snapshots/acp/goal-authorization/` 会话词汇（含授权注入的 `user/message` 与既有 `goal/change`）全部存在于上一版发布物 `40d8ea8dd4` 的 `known-event-types.ts`，无一缺失——旧构建回读无损、回滚无迁移 |
| `openlogos smoke`（Gate 3.8，官方 dispatcher 串行全量） | PASS：21 通过 / 0 失败 / 12 跳过，覆盖 100%（33 用例，较 D3 期 32→33 定义、20→21 通过，新增 SMOKE-acp-network-08；SMOKE-core-06/07/25 真实 API 通道全绿） |
| `openlogos verify`（Gate 3.6，dispatcher 修复后对最终树复跑） | PASS：61 通过 / 0 失败、覆盖 100%（238/238）、设计时校验 14/14；pre_run exit=0（86s） |

## 部署方案逐项验证（core-01 §十六）

1. **发布物与前置检查** — 355 artifacts 构建于 `55b4971811`；零新增 Config（config-catalog 仅 file:line 漂移）；`docs/upgrade-guide/v0.2.1-alpha.1/acp-goal-approval/` 中英文指南已随 [code] 入库（ask 行为变化、goal-review 意图、Deny/取消语义、无通道行为不变、双 SDK 零改动）。
2. **staging goal 授权卡往返（SMOKE-acp-network-08）** — 本地通道全量执行并 PASS：mock 模型触发未授权 `complete` 调用 → 客户端收 `session/request_permission`（Authorize/Deny 词汇，随行 tool_call 指名 `update_goal` 完成调用）→ Deny 分支 goal 保持 active 且无任何注入 → 第二次征求 Authorize → 会话日志核对注入的源 user 授权消息（steer 文本前缀 `The human authorized `）与完成事件。staging 目标无交互握手，按方案 skip 语义记录（dispatcher 输出 `staging handshake skipped`），永不报 PASS。
3. **Deny/取消/无通道/见证路径** — Deny 与取消路径由 goal-approval.spec（deny → 注明的权威拒绝；cancelled → turn-back 文本）与 tool-goal.spec（Deny 注明拒绝含人类自由文本反馈、dismissed → turn-back、in-flight 取消 → 规范中止）承载；无通道 fail-fast（headless 组合，`ctx.get('userQuestions')` 不存在）由 tool-goal.spec 无通道字节一致拒绝用例承载（真实 Loader 组合）；admitted round 与 direct-human 路径不征求由 tool-goal.spec「两种见证路径 0 征求」用例承载。
4. **回归** — SMOKE-acp-network-01..07 全过（prompt/resume、permission、skills、plan mode、compaction、multi-provider 面）；S49 审批策略、S50 技能枚举、S51 计划模式、S52 压缩面、S03 ACP 主链路（network + multi-provider）单元回归全过（150 测试 / 30 账本）。

## 部署后检查（core-01 §十六）

- 授权卡往返全链路（SMOKE-acp-network-08）：✅（dispatcher 本地通道全量）
- Deny/取消路径：✅（goal-approval.spec 03 分支 + tool-goal.spec 注明拒绝/turn-back/中止）
- 无通道 fail-fast：✅（tool-goal.spec 真实 Loader 无通道组合）
- plan-review 意图应答不受影响：✅（plan-mode.spec UT-S51-04 三结果 + goal-approval.spec 先认领后落 plan 面链序）
- SMOKE-acp-network-01..07 既有回归：✅（本轮 dispatcher 全过）
- 服务启动：✅（冒烟自举 acp-network profile 子进程全链路）

## 只读与零持久化行为

- 零新增持久化事件类型与 Secret/环境变量/组合配置键：授权注入是普通 `user/message`，授权结果标记在工具结果 JSON 内，征求卡是 wire 面呈现（不入会话日志）；`SessionEventMap` 无新增成员，Session format 维持；回滚无迁移（程序化核对见执行摘要）。
- 无部署侧开关：征求行为由 userQuestions 通道存在性决定；ACP 客户端无需 capability 声明，按普通权限卡片处理；`goal-review` 意图为可选呈现优化（dspm 指引见 acp-network 部署方案 delta）。

## 回滚点

1. 回滚基线：上一版发布物为 D3 终态（版本基线 `ba6da5f41c`，归档态 `40d8ea8dd4`，本变更线合并提交 `ed600addfd` 的父）；revert 本变更提交（`ed600addfd`、`ace2b15135`、`df47b871b2`、`55b4971811`）后重建即可。
2. 会话数据无需回滚迁移：零新增持久化事件类型；旧构建读取本版会话日志无损。
3. 旧构建无 ask 行为：未授权完成回到立即 `GOAL_TOOL_AUTHORITY_REQUIRED`；进行中的征求随旧进程终止，无残留状态。

## 升级指南

`docs/upgrade-guide/v0.2.1-alpha.1/acp-goal-approval/`（中英文）：自动应答 `allow_once` 的客户端需按 `approve`/`deny` 选项 id 过滤（原策略会静默授权 goal 完成与阻塞）、交互客户端零协议改动、宿主 UI 的 `goal-review` 意图处理、cordis.yml 零改动、回滚语义与确认步骤。

## 未解决风险

- **无 S54 范围未解决项。**
- 本机自跳过集与 D3 期一致（非本变更回归）：SMOKE-core-12/13/16..19（root 环境 embedded-postgres initdb 目录权限拒绝）、SMOKE-core-08（需签名安装器人工验证）、SMOKE-core-09/10/11/14/15（fleet staging supervisor 未运行）。CI 平台矩阵负责这些信号；k8s staging 集群不在本机环境。
- 执行插曲（已闭环）：首轮官方 Gate 3.8 FAIL——smoke dispatcher 账本只发 01..07 行，新定义的 SMOKE-08 被记为 uncovered（33 定义/32 执行/覆盖 97%）；本地通道实际全量绿。修复 = dispatcher 补 08 账本行（`55b4971811`，本地批次已含 08 全量往返，行状态跟随本地批次；staging 保持 skip 语义），复跑 21/0/12/覆盖 100% 全绿。红色中间态未入任何提交；该修复使 Gate 3.6 证据同步对最终树复跑（86s 快速通道，PASS）。

## 执行命令

```sh
pnpm run build                                        # 355 client artifacts @ 55b4971811
OPENLOGOS_SMOKE_RESULT_PATH=/tmp/s54-deploy-smoke.jsonl \
  pnpm exec tsx scripts/smoke-acp-network.ts          # SMOKE-acp-network-01..08 全过（08 修复后含账本行）
OPENLOGOS_RESULT_FILE=/tmp/s54-deploy-tests.jsonl \
  pnpm exec vitest run packages/goal/tool-goal/tests/tool-goal.spec.ts \
           packages/interaction/user-questions/tests/user-questions.spec.ts \
           packages/acp/acp/tests/goal-approval.spec.ts \
           packages/acp/acp/tests/plan-mode.spec.ts \
           packages/acp/acp/tests/permission-roundtrip.spec.ts \
           packages/acp/acp/tests/permission-control.spec.ts \
           packages/acp/acp/tests/skill-list.spec.ts \
           packages/acp/acp/tests/compaction.spec.ts \
           packages/acp/acp-network/tests/network.spec.ts \
           packages/acp/acp-network/tests/multi-provider.spec.ts \
           packages/interaction/user-approval/tests/approval.spec.ts   # 150/150,30 账本全 pass
openlogos smoke                                       # Gate 3.8 PASS（21/0/12,33 用例,覆盖 100%）
openlogos verify                                      # Gate 3.6 PASS（61 过/覆盖 100%/设计时 14/14,pre_run 86s）
```

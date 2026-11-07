# 部署报告：ACP 计划模式入口（dsh-acp-plan-mode）

> 提案：`dsh-acp-plan-mode`
> 时间：2026-11-07T17:40+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；ACP-over-network 真实 WebSocket 往返 + 既有 Secret；ST-S51-01 经真实 API）
> 发布物源码 commit：`d745348581`（版本 0.2.1-alpha.1）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `d745348581`） | 成功（355 client artifacts） |
| SMOKE-acp-network-01..05 真实协议冒烟（临时账本 + 官方 dispatcher 五通道） | PASS ×5（05 为本变更新增计划模式面通道：modes 广告、set_mode plan 提交 + 恰一次 current_mode_update、resume 恢复 plan、静默 noop、词表错误分支、prompt 往返） |
| S51 + S50 + S49 回归套件（reporter 账本） | 16/16 通过（UT-S51-01..06 全量；UT-S50-01..05；UT-S49-01/02/05/06 + ST-S49-02） |
| acp-network 既有单元回归 | 4/4 通过 |
| ST-S51-01 真实 API 全链路（`dsh --profile acp` + 真实 DeepSeek API） | PASS：模型真实调用 `exit_plan_mode`，评审经 `session/request_permission` 携带 approve/keep-planning（allow_once/reject_once，Approve / Keep planning），approve 应答在轮中提交 normal，未知 modeId 词表错误，resume 恢复；真实轮次 35.7s、39 条更新 |
| `openlogos smoke`（Gate 3.8，官方 dispatcher 串行全量） | PASS：18 通过 / 0 失败 / 12 跳过，覆盖 100%（30 用例，含新增 SMOKE-acp-network-05） |
| `openlogos verify`（Gate 3.6，对最终账本与最终规格文本） | PASS：218 定义用例、0 失败、158 基线跳过、覆盖 100%；pre_run exit=0（442s，[code] 切片末执行，发布树未再变更） |

## 部署方案逐项验证（core-01 §十三 + acp-network 计划模式面四步）

1. **有效 token 连接后 `session/new`，核对响应 `modes`** — SMOKE-05 真实 WebSocket 客户端核对：`availableModes` 恰为 plan/normal 二值（每项含非空 name），`currentModeId` 为 `normal`；ST-S51-01 在 shipped stdio profile 上复现同一广告。
2. **`session/set_mode { modeId: 'plan' }` 后 `current_mode_update` 到达；`session/resume` 恢复 plan；切回 normal 核对** — SMOKE-05：set plan 后恰一次 `current_mode_update(plan)`；closeSession 后重连 `session/resume` 返回 `currentModeId: 'plan'`；set normal 恰一次更新。ST-S51-01 复现 resume 恢复（normal 侧）。
3. **重复设置确认无冗余更新；未知 modeId 验证 invalid params 词表错误** — SMOKE-05：重复 set normal 零新增更新；`modeId: 'other'` 返回 -32602 且消息含 `unknown session mode: other` 与 `plan, normal` 词表；SMOKE-05 同轮断言被拒请求零更新。
4. **回归既有 prompt/resume、审批策略（S49）与技能枚举（S50）** — SMOKE-01/02（prompt/resume）、SMOKE-03 + UT-S49-01/02/05/06/ST-S49-02（审批策略）、SMOKE-04 + UT-S50-01..05（技能枚举）本轮全部 pass；`user-questions/request` 消费者新增 acp 已在重生成的 `docs/event-producer-consumer.md` 记录，非 plan-review 请求保持无应答者行为（UT-S51-05）。

### plan-review 三态映射（依赖模型行为，确定性冒烟不含）

- ST-S51-01（真实 API）：模型在 plan 模式下研究工作区并真实调用 `exit_plan_mode`，bridge 在工具卡片更新之后下发唯一一次 `session/request_permission`（`toolCallId` 对齐评审调用），approve 应答后轮次继续至 `end_turn` 且轮中提交 normal（`current_mode_update` 序列为 `plan → normal`）。
- dismissed → ASK_CANCELLED（评审被关闭分支）与 keep-planning → 拒绝映射由 UT-S51-04 在真实 bridge + 真实 `exit_plan_mode` 工具链路上承载（确定性，无需模型）；非 plan-review 提问不受影响由 UT-S51-05 承载。

## 只读与零持久化行为

- 本变更零新增持久化数据：模式状态复用 S11 既有 `plan/mode` 事件（ST 证据：`snapshots/acp/plan-mode` 与 UT 用例均确认 `current_mode_update` 由持久事件派生）；`SessionEventMap` 无新增成员，Session format 维持 4；回滚无迁移。
- `session/set_mode` 为 ACP 1.4.0 标准方法（`SetSessionModeRequest/Response`），`modes` 字段为标准可选广告——部署无需新增装配（`acp` / `acp-network` profile 经 `dsh-base` 已挂载 `@deepseek-ai/dsh-plan-mode`）；插件被剥离的组合 fail-loud（internal error + 省略 `modes`），UT-S51-06 承载。

## 部署后检查（core-01 §十三）

- `modes` 广告结构合法（二值词表 + name）：✅（SMOKE-05 + keyless 快照 + ST-S51-01）
- set_mode 往返时限（≤2s 检查线）：✅（SMOKE-05 五通道合计 ~1.2s，模式提交本身同步返回、更新先于响应帧入队——bridge `drainUpdates()` 排序在 UT 与快照固定）
- `current_mode_update` 到达：✅（SMOKE-05 恰一次断言；真实 API ST-S51-01 复现）
- 未知 modeId 错误分支：✅（SMOKE-05 + UT-S51-01 + ST-S51-01）
- SMOKE-acp-network-01..04 既有回归：✅（本轮 dispatcher 全过）
- 服务启动：✅（冒烟自举 acp-network profile 子进程全链路；ST-S51-01 自举 shipped stdio profile 全链路）

## 回滚点

1. 回滚基线：上一版发布物 commit `f148f8aeca`（已归档变更 dsh-acp-skills-list 的发布态）；revert 本变更线两个提交（`e4de4fe540` 规格合并、`d745348581` 实现）后重建即可。
2. 会话数据无需回滚迁移：零新增持久化数据，`plan/mode` 事件为既有格式；回滚后旧构建不认识 `session/set_mode`（客户端得 -32601）、`modes` 字段不再出现（客户端按可选字段容忍）；计划模式下经 ACP 的 `exit_plan_mode` 评审回到无应答者行为（`NO_PROVIDER`）——升级指南已按既有缺陷如实说明。
3. 配置面：不新增 Secret、环境变量或 profile 配置项；自定义 profile 剥离 plan-mode 插件时 set_mode 返回 internal error 且省略 `modes`（文档化 fail-loud，非部署缺陷）。

## 升级指南

`docs/upgrade-guide/v0.2.1-alpha.1/acp-plan-mode/`（中英文）：modes 广告的字段存在性语义、set_mode 响应不承诺生效（以 `current_mode_update` 为唯一生效事实、更新先于响应）、queued 时序契约、plan-review optionId 词表与取消映射、插件缺席 fail-loud。

## 未解决风险

- **无 S51 范围未解决项。**
- 本机自跳过与上一版发布物一致（非本变更回归）：postgres 支撑的套件与 SMOKE-core-12..19（root 环境 embedded-postgres initdb 拒绝）、SMOKE-core-08（需签名安装器人工验证）、SMOKE-core-09/10/11（fleet staging supervisor 未运行）、stagehand 浏览器快照（本机 load-hook 环境红）。CI 平台矩阵负责这些信号；k8s staging 集群不在本机环境（SMOKE-05 已具备纯标准方法面，可在 relay 侧直接执行）。

## 执行命令

```sh
pnpm run build
OPENLOGOS_SMOKE_RESULT_PATH=/tmp/s51-deploy-smoke.jsonl \
  pnpm exec tsx scripts/smoke-acp-network.ts        # SMOKE-acp-network-01..05 真实冒烟
OPENLOGOS_RESULT_FILE=/tmp/s51-deploy-tests.jsonl \
  pnpm exec vitest run packages/acp/acp/tests/plan-mode.spec.ts \
           packages/acp/acp/tests/skill-list.spec.ts \
           packages/acp/acp/tests/permission-control.spec.ts \
           packages/acp/acp/tests/permission-roundtrip.spec.ts
pnpm exec vitest run packages/acp/acp-network       # acp-network 既有回归
timeout 300 pnpm exec tsx /tmp/s51-st-e2e.ts        # ST-S51-01 真实 API 全链路（一次性驱动脚本，不入库）
openlogos smoke                                     # Gate 3.8 PASS
openlogos verify                                    # Gate 3.6 PASS（pre_run exit=0，[code] 切片末执行）
```

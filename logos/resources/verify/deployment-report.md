# 部署报告：ACP 审批策略配置（dsh-acp-permission-policy）

> 提案：`dsh-acp-permission-policy`
> 时间：2026-11-07T11:58+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；ACP-over-network 真实 WebSocket 往返 + 既有 Secret）
> 发布物源码 commit：`da8e79a698`（版本 0.2.1-alpha.1）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `da8e79a698`） | 成功（355 client artifacts） |
| SMOKE-acp-network-01/02/03 真实协议冒烟（临时账本 + 官方 dispatcher 双通道） | PASS ×3（always 往返 1131ms，远低于 5s 部署后检查线） |
| S49 套件（permission-control + permission-roundtrip，reporter 账本） | 7/7 通过（含 UT-S49-05 resume 折叠恢复 + configOptions 回显） |
| `openlogos smoke`（Gate 3.8，官方 dispatcher 串行全量） | PASS：16 通过 / 0 失败 / 12 跳过，覆盖 100%（28 用例） |
| `openlogos verify`（Gate 3.6，对最终账本与最终规格文本） | PASS：205 定义用例、0 失败、148 基线跳过、覆盖 100%；pre_run exit=0 |

## 部署方案逐项验证（acp-network 计划五项 + core-01 步骤）

1. **有效连接后设置 `permission_policy=always`** — SMOKE-03 与 UT-S49-02 真实 WebSocket 客户端设置成功，configOptions 回显 `always`。
2. **带工具调用 prompt 的 `session/request_permission` 往返** — SMOKE-03：恰两次询问、每次恰含 `allow_once` + `reject_once` 两个一次性选项、无持久授权项；allow-once 后工具执行。
3. **第二次调用 reject-once** — 调用被拒、模型收到拒绝反馈、会话继续、`stopReason` 正常结算（`assertStopReason`）。
4. **未知词表值 fail-loud** — `permission_policy='paranoid'` 返回 `unknown permission policy value` 错误、状态不变（SMOKE-03 断言 + UT-S49-01 直接控制调用路径）。
5. **close → resume 策略折叠恢复** — UT-S49-05：resume 后 `currentValue: 'always'` 回显，且恢复的策略继续门控执行（每次工具调用仍询问）；`approval_preset` 回归由 UT-S49-06（目录预设逐项应用 + 派生当前值）与 SMOKE-03 本地组合（approval + presets 双挂载）覆盖。

## 持久化行为（本次变更核心）

- `always` 切换落新增普通事件类型 `approval/policy-always`（`version: 0`，same-version 记录 `docs/persistence-changes/2026-11-06-approval-policy-always-event`）；ask/never 切换沿用既有 `approval/policy`（payload 冻结于 format-4 词表）。
- 快照 `permission-policy` 已按真实 API 重录并 refresh（无 key 回放 182 通过）；新事件在录制会话中逐字可见。

## 部署后检查（core-01 计划）

- configOptions 广告含 `permission_policy` 与 `permission_preset` 两个 id：✅（SMOKE-01/03 + UT-S49-01）
- `always` 往返时限（≤5s）：✅（账本 duration_ms=1131）
- fail-closed 分支可复现：✅（reject-once 拒绝执行 + `unavailable` 无应答者路径 UT-S49-03）
- SMOKE-acp-network-01/02 既有回归保持：✅（官方 dispatcher 本轮 pass）
- 服务启动：✅（冒烟自举 acp-network profile 子进程，initialize → session/new → 目录发布 → 设置 → prompt 全链路）

## 回滚点

1. 回滚基线：上一版发布物 commit `fb8b38fa68`（已归档变更 dsh-provider-model-discovery 的发布态）；revert 本变更线四个提交（`88ebecfed3`..`da8e79a698`）后重建即可。
2. 会话数据无需回滚迁移（Session format 维持 4）。回滚后旧构建可正常打开仅含 ask/never 的会话；含 `approval/policy-always` 事件的会话被旧构建拒绝打开（required-on-read fail-loud，报未知事件类型）——已记录于持久化变更与升级指南，不作为回滚前置条件。
3. 配置面：不新增 Secret、环境变量或 profile 配置项；部署的 `approval` 配置仍只接受 `ask`/`never`，未设置策略的会话升级前后均为默认 `ask` 放行语义。

## 升级指南

`docs/upgrade-guide/v0.2.1-alpha.1/acp-permission-policy/`（中英文）：新增 option id 渲染/忽略、`always` 词表值、一次性选项语义保持、读兼容立场（旧构建拒开含 always 切换的日志）、跨版本共享存储先升级读取方。

## 未解决风险

- **无 S49 范围未解决项。**
- 本机自跳过与上一版发布物一致（非本变更回归）：postgres 支撑的 fleet/storage 套件与 SMOKE-core-12..19（root 环境 embedded-postgres initdb 拒绝）、SMOKE-core-08（需签名安装器人工验证）、SMOKE-core-09/10/11（fleet staging supervisor 未运行）。CI 平台矩阵负责这些信号。
- 部署排查插曲（已复原，留档）：本机 `/usr/bin/docker`（docker-desktop WSL 集成 shim）在 Docker Desktop 未运行时为悬空链接，指向 Windows 侧 `docker.exe` 的替代 shim 会因 Windows 引擎对 WSL 路径构建上下文的符号链接处理差异导致 `SMOKE-core-24` compose 构建失败；移除替代 shim、以 WSL 集成 CLI 运行后全部通过。仓库与产物未做任何 docker 相关改动。

## 执行命令

```sh
pnpm run build
OPENLOGOS_SMOKE_RESULT_PATH=/tmp/s49-deploy-smoke.jsonl \
  pnpm exec tsx scripts/smoke-acp-network.ts        # SMOKE-acp-network-01/02/03 真实冒烟
OPENLOGOS_RESULT_FILE=/tmp/s49-deploy-tests.jsonl \
  pnpm exec vitest run packages/acp/acp/tests/permission-control.spec.ts \
           packages/acp/acp/tests/permission-roundtrip.spec.ts
openlogos smoke                                     # Gate 3.8 PASS
openlogos verify                                    # Gate 3.6 PASS（pre_run exit=0）
```

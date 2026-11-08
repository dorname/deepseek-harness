# 部署报告：ACP 会话压缩面（dsh-acp-compaction）

> 提案：`dsh-acp-compaction`
> 时间：2026-11-08T12:15+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；ACP-over-network 真实 WebSocket 往返走本地 mock LLM；UT-S52-02/ST-S52-01 经真实 API）
> 发布物源码 commit：`80df47eb8c`（版本 0.2.1-alpha.1）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `80df47eb8c`） | 成功（355 client artifacts） |
| SMOKE-acp-network-01..06 真实协议冒烟（临时账本 + 官方 dispatcher 六通道） | PASS ×6（06 为本变更新增压缩面通道：结构化结果、有序 `compaction_update` 对、busy 竞态、fresh null、unknown session、未声明连接静默、resume 经压缩日志） |
| S52 + S51 + S50 + S49 回归套件（reporter 账本） | 28 测试 / 21 账本记录全部通过（UT-S52-01/03..06；UT-S51-01..06；UT-S50-01..05；UT-S49-01/02/05/06 + ST-S49-02） |
| acp-network 既有单元回归 | 4/4 通过 |
| UT-S52-02 + ST-S52-01 真实 API 全链路（`dsh --profile acp` + 真实 DeepSeek API） | PASS（final1 与充值后 final3 两次完整绿跑，均 exit 0；中间一次稳定性复跑因账户余额耗尽失败，充值后复绿）：真实模型三段 prose 轮产历史 → compact 同步结构化结果（compactionId/summarySeq/shadowedCount/shadowedTokenCount/summary 内容块）且有序通知对到达；mid-turn busy 竞态（真实 bash 工具锚点）→ `data.code:'busy'` + 回合干净取消；unknown-session `-32602`、fresh-history `{result:null}`；第二进程 resume 经压缩日志继续 ACK 回合 |
| `openlogos smoke`（Gate 3.8，官方 dispatcher 串行全量） | PASS：19 通过 / 0 失败 / 12 跳过，覆盖 100%（31 用例，含新增 SMOKE-acp-network-06；充值后复跑 core-06/07/25 真实 API 通道转绿） |
| `openlogos verify`（Gate 3.6，对最终账本与最终规格文本） | PASS：225 定义用例、0 失败、165 基线跳过、覆盖 100%；pre_run exit=0（[code] 切片末执行，发布树未再变更） |

## 部署方案逐项验证（core-01 §十三 + acp-network 压缩面）

1. **有效 token 连接后 `session/compact`，核对同步结果结构** — SMOKE-06：声明 `session.compaction` 的连接上 compact 返回 `compactionId`/`summarySeq`/`shadowedCount`/`shadowedTokenCount`/`summary` 内容块；`compaction_update` in_progress → completed 有序对先于响应帧（bridge `drainUpdates()` 排序）。UT-S52-02 在 shipped stdio profile + 真实 API 上复现同一结构。
2. **真实模型历史 → 摘要生效 → resume** — ST-S52-01：三段真实 prose 轮后 compact，第二进程 `session/resume` 经压缩日志重建上下文并继续 ACK 回合；SMOKE-06 以 mock LLM 固定同一 resume 腿。
3. **busy 竞态** — mid-turn（确定性锚：真实 bash 工具调用完成后的流式尾段，`agent_message_chunk` 在轮末才提交故不可作锚）compact 返回 -32603 + `data.code:'busy'`，回合 cancel 干净落地（`stopReason: cancelled`，探针文件已写）；SMOKE-06 + ST-S52-01 + UT-S52-04 承载。
4. **错误分支** — unknown session `-32602`；fresh history `{result:null}` 零事件零通知；六失败码经 internal error `data.code` 携带并复用 `/compact` 人类文本（UT-S52-03）。
5. **声明/未声明 compaction 能力两客户端通知面** — 声明连接收有序对；未声明连接零 `compaction_update`（SMOKE-06 双连接 + UT-S52-05 + 快照场景）。
6. **回归既有 prompt/resume、S49 审批策略、S50 技能枚举、S51 计划模式** — SMOKE-01..05 本轮全过；S49/S50/S51/S52 单元回归 28 测试全过；审批、技能、模式面不感知压缩面。

### 真实模型压不缩边界（依赖模型行为，确定性冒烟不含）

- 引擎 shrink invariant（构帧摘要 token 数 ≥ 影子跨度 token 数 → `summary` 失败码）对真实模型摘要长度非确定；本切片把 e2e 的历史产额从两段扩为三段 ~150 词 prose 轮，保持影子跨度对任何合理摘要的余量（与 SMOKE-06 condense 提示词同一论证）。产品侧把六失败码如实映射 internal error `data.code`（client 可重试），已文档化于升级指南；非部署缺陷。

## 只读与零持久化行为

- 本变更零新增持久化事件类型：`compaction/start`、`compaction/summary`、`compaction/end` 为既有 dsh-compaction 手动压缩同款三元组；ACP 触发仅为既有三元组新增 bridge 铸造的 `sourceCommandId`（`acp-` 前缀，UT-S52-02 与 ST 断言）；`SessionEventMap` 无新增成员，Session format 维持 4；回滚无迁移。
- `session/compact` 为 SDK 1.4.0 已导出的 `@experimental` 扩展方法，部署无需新增装配：默认组合已挂载 compaction 引擎，被剥离的组合 fail-loud（internal error），UT-S52-06 承载。

## 部署后检查（core-01 §十三）

- compact 响应结构合法：✅（SMOKE-06 + keyless 快照 + UT-S52-02 真实 API）
- `compaction_update` 有序对先于响应：✅（SMOKE-06 + UT-S52-05 固定排序；ST-S52-01 复现）
- busy 分支与回合取消：✅（SMOKE-06 + ST-S52-01 + UT-S52-04）
- unknown-session / fresh-null 分支：✅（SMOKE-06 + ST-S52-01 + UT-S52-01/04）
- 未声明连接静默：✅（SMOKE-06 双连接 + UT-S52-05）
- resume 经压缩日志：✅（SMOKE-06 resume 腿 + ST-S52-01 第二进程）
- SMOKE-acp-network-01..05 既有回归：✅（本轮 dispatcher 全过）
- 服务启动：✅（冒烟自举 acp-network profile 子进程全链路；ST-S52-01 自举 shipped stdio profile 全链路）

## 回滚点

1. 回滚基线：上一版发布物 commit `d745348581`（已归档变更 dsh-acp-plan-mode 的发布态）；revert 本变更线两个提交（`609ef15b5a` 规格合并、`80df47eb8c` 实现）后重建即可。
2. 会话数据无需回滚迁移：零新增持久化事件类型，compaction 三元组为既有格式；回滚后旧构建不认识 `session/compact`（客户端得 -32601）；`compaction_update` 仅在 capability 声明时派生，旧构建不接受该声明故天然不出现；此前已写入的 compaction 事件由同版本引擎记录，旧构建读取无损。
3. 配置面：不新增 Secret、环境变量或 profile 配置项；组合剥离 compaction 引擎时 `session/compact` 返回 internal error（文档化 fail-loud，非部署缺陷）。

## 升级指南

`docs/upgrade-guide/v0.2.1-alpha.1/acp-compaction/`（中英文）：capability 声明（`session.compaction`）与通知面、有序更新对先于响应写回的时序契约、busy 可重试语义、六失败码 `data.code` 映射与人类文本、`{result:null}` 无可压缩历史语义。

## 未解决风险

- **无 S52 范围未解决项。**
- 真实模型摘要长度的非确定性使引擎压不缩边界（`summary` 失败码）不可根除：e2e 以三段 prose 轮保持余量，产品侧行为如实文档化，client 可重试——非部署缺陷。
- 执行插曲（已闭环）：切片执行中 DeepSeek 账户余额一度耗尽，Gate 3.8 的三个真实 API 通道（SMOKE-core-06/07/25）与一次 e2e 复跑因此失败；用户充值后复跑 Gate 3.8 全绿、e2e 复跑 exit 0。红色中间态未入任何提交（账本已还原后以全绿结果落账）。
- 本机自跳过与上一版发布物一致（非本变更回归）：postgres 支撑的套件与 SMOKE-core-12..19（root 环境 embedded-postgres initdb 拒绝）、SMOKE-core-08（需签名安装器人工验证）、SMOKE-core-09/10/11（fleet staging supervisor 未运行）、stagehand 浏览器快照（本机 load-hook 环境红）。CI 平台矩阵负责这些信号；k8s staging 集群不在本机环境（SMOKE-06 依赖本地组合，staging 目标按方案 skip 且永不报 PASS）。

## 执行命令

```sh
pnpm run build                                        # 355 client artifacts @ 80df47eb8c
OPENLOGOS_SMOKE_RESULT_PATH=/tmp/s52-deploy-smoke.jsonl \
  pnpm exec tsx scripts/smoke-acp-network.ts          # SMOKE-acp-network-01..06 真实协议冒烟
OPENLOGOS_RESULT_FILE=/tmp/s52-deploy-tests.jsonl \
  pnpm exec vitest run packages/acp/acp/tests/compaction.spec.ts \
           packages/acp/acp/tests/plan-mode.spec.ts \
           packages/acp/acp/tests/skill-list.spec.ts \
           packages/acp/acp/tests/permission-control.spec.ts \
           packages/acp/acp/tests/permission-roundtrip.spec.ts
pnpm exec vitest run packages/acp/acp-network         # acp-network 既有回归
DSH_E2E_MAX_WORKERS=1 pnpm vitest run --config vitest.e2e.config.ts \
  apps/cli/tests/profiles/acp/tests/compaction.e2e.ts # UT-S52-02 + ST-S52-01 真实 API（final1、充值后 final3 两次绿跑）
openlogos smoke                                       # Gate 3.8 PASS（19/0/12；充值后复跑）
```

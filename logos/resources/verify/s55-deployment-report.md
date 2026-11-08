# 部署报告：ACP 拉式会话导出三元组（dsh-acp-session-export）

> 提案：`dsh-acp-session-export`
> 时间：2026-11-09T03:46+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；ACP-over-network 真实 WebSocket 往返走本地导出组合；staging 交互握手按方案 skip 语义记录，永不报 PASS）
> 发布物源码 commit：`4a34d9cefc`（实现链 `ac0ea3f6b9` spec merged → `4a34d9cefc` [code] → 本报告随部署证据提交；版本 0.2.1-alpha.1）
> 授权说明：D8 全周期（含 [deploy] 与归档两个人工确认点）由用户 2026-11-09 /goal「全权授权给你，先归档D6然后完成D8」覆盖。

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `4a34d9cefc`） | 成功（355 client artifacts，build exit 0） |
| SMOKE-acp-network-01..09（官方 dispatcher，临时账本） | PASS ×9（09 为本变更新增导出三元组面：scripted turn 落日志 → `session/export_begin` 开游标（UUID + `dsh-session-<sessionId>.zip` 文件名）→ read 分块 ≤262144、canonical base64 → 写盘解包断言 `session.v4.jsonl` 含 prompt/reply 事件 → 耗尽后 read 回 `unknown_cursor`（-32602）→ cancel 应 `{}` 且 cancel/read 双探针均 `unknown_cursor` → 未知会话 `Invalid params`）；staging handshake skipped（无 Ready deploy/creds），按 skip 语义记录，未报 PASS |
| S55 + S49..S54/S03/S26 回归套件（reporter 账本） | 14 文件 / 211 测试全部通过，39 账本记录全 pass（新增 acp `export.spec.ts` UT-S55-01..08 含 includeDescendants 谱系语义、acp-network `export.spec.ts` ST-S55-01 真实 WebSocket 往返、S26 web/host 面 `archive.host.spec.ts`；S49 approval/permission-control/permission-roundtrip、S50 skill-list、S51 plan-mode、S52 compaction、S54 goal 双面、S03 network/multi-provider、user-questions/user-approval 面） |
| 回滚路径确认（零新增持久化事件类型） | 程序化核对：`git diff ac0ea3f6b9..4a34d9cefc` 对 `packages/session/**` 与 `packages/core/session/src/known-event-types.ts` 为空（后者末次变更为 D6 期之前的 `0643a79a0b`）——三元组纯 wire 面、对会话日志不可见；旧构建对三个方法按 JSON-RPC 未知方法应答 `Method not found`（-32601），旧构建回读本版会话日志无损、回滚无迁移 |
| `openlogos smoke`（Gate 3.8，官方 dispatcher 串行全量） | PASS：22 通过 / 0 失败 / 12 跳过，覆盖 100%（34 用例，较 D6 期 33→34 定义、21→22 通过，新增 SMOKE-acp-network-09；SMOKE-core-06/07/25 真实 API 通道全绿） |
| `openlogos verify`（Gate 3.6，[code] verify 阶段对 `4a34d9cefc` 记录） | PASS：247 用例 0 失败、覆盖 100%、pre_run exit=0（S55 两个 spec 已入 pre_run 清单）；此后源码零变更，证据持续有效 |

## 部署方案逐项验证（core-01 §十七）

1. **发布物与前置检查** — 355 artifacts 构建于 `4a34d9cefc`；新增 Config `exportChunkBytes`（默认 262144，16384–4194304）与 `exportCompressionLevel`（0–9，默认 6）已入 config-catalog 中英文条目；`docs/upgrade-guide/v0.2.1-alpha.1/acp-session-export/` 中英文指南已随 [code] 入库（采用方读取循环、拒绝未知方法客户端零影响、cordis.yml 可选 pin、回滚 -32601 语义、确认步骤）；python runtime 闭包已补 `dsh-session-log-export` 依赖（186 包图）。
2. **ACP 会话内导出往返（ST-S55-01 + SMOKE-acp-network-09）** — 真实 WebSocket 往返：scripted turn 落日志 → `export_begin` 应答 UUID 游标与规范文件名 → read 循环分块 ≤16384（harness 收紧上限以验证绑定）、canonical base64 → 分块写盘后 `unzipSync` 解包断言唯一成员 `session.v4.jsonl` 含驱动 prompt 与 reply 事件 → 耗尽后 read 以 `unknown_cursor`（`data.code`，随 Invalid params -32602）终态 → cancel 应 `{}` 且取消后 read/cancel 双探针均 `unknown_cursor` → 未知会话 id `export_begin` 以 `Invalid params: unknown session` 失败。本地冒烟通道（SMOKE-09）以默认 262144 上限复验同一链路并含解包字节断言。
3. **cancel/unknown_cursor 路径** — 由 ST-S55-01 终态分支与 acp 单元套件承载：游标单次消费、cancel 即刻释放、已取消/未知游标的 read 与 cancel 一律 `unknown_cursor`，无残留状态（UT-S55-01..08，export.ts 覆盖 100%）。
4. **includeDescendants 语义** — 由 acp `export.spec.ts` 谱系用例承载：`includeDescendants: true` 追溯会话谱系并把每份后代日志置于 `subagents/<id>/` 之下；缺省只出根日志；HTTP `/api/session.export` 相同输入下字节一致（S26 生产者共享未变）。
5. **既有导出（S26 web 面）与回归** — S26 web/host 面 `archive.host.spec.ts` 全过；SMOKE-acp-network-01..08 全过（prompt/resume、permission、skills、plan mode、compaction、multi-provider、goal 授权面）；S49..S54 单元回归全过（211 测试 / 39 账本）。

## 部署后检查（core-01 §十七）

- 导出三元组全链路（begin → read 至 eof → 解包 → cancel/unknown_cursor）：✅（ST-S55-01 + SMOKE-09 双通道）
- 未知会话/未知游标错误词表：✅（`not_found` / `export_failed` / `unknown_cursor` 由单元套件逐词覆盖）
- includeDescendants 谱系：✅（acp export.spec 谱系用例）
- S26 web 下载面不受影响：✅（archive.host.spec + 生产者共享声明）
- SMOKE-acp-network-01..08 既有回归：✅（本轮 dispatcher 全过）
- 服务启动：✅（冒烟自举 acp-network profile 子进程全链路）

## 只读与零持久化行为

- 零新增持久化事件类型与 Secret/环境变量/组合配置键：三元组是纯 wire 扩展方法，导出快照对会话日志不可见（`SessionEventMap` 无新增成员，Session format 维持）；`session/close` 不中止进行中的导出，同一会话的并发快照相互独立。
- 无部署侧开关：新 Config 两字段仅调分块与压缩档位，缺省即规范行为；ACP 客户端无需 capability 声明，拒绝未知方法的客户端零影响；dspm 指引见 acp-network 部署方案 delta。

## 回滚点

1. 回滚基线：上一版发布物为 D6 终态（[code] `ace2b15135`、verify `df47b871b2`、终态 `55b4971811`；本变更线 spec merged 提交 `ac0ea3f6b9` 的父）；revert 本变更提交（`ac0ea3f6b9`、`4a34d9cefc`）后重建即可。
2. 会话数据无需回滚迁移：零新增持久化事件类型；旧构建读取本版会话日志无损（程序化核对见执行摘要）。
3. 旧构建无导出方法：三个方法按 JSON-RPC 未知方法应答 `Method not found`（-32601），客户端采用方按升级指南以该方法缺失分支回退；进行中的导出游标随旧进程终止，无残留状态。

## 升级指南

`docs/upgrade-guide/v0.2.1-alpha.1/acp-session-export/`（中英文）：采用方 begin → read 循环至 eof → 拼接 base64 → 解包；断连/重启重新 begin（时点快照不跨进程续传）；拒绝未知方法的客户端零协议改动；cordis.yml 可选 pin `exportChunkBytes` / `exportCompressionLevel`；回滚 -32601 语义与确认步骤。

## 未解决风险

- **无 S55 范围未解决项。**
- 本机自跳过集与 D6 期一致（非本变更回归）：SMOKE-core-12/13/16..19（root 环境 embedded-postgres initdb 目录权限拒绝）、SMOKE-core-08（需签名安装器人工验证）、SMOKE-core-09/10/11/14/15（fleet staging supervisor 未运行）。CI 平台矩阵负责这些信号；k8s staging 集群不在本机环境。
- staging 交互握手按 skip 语义记录（无 Ready deploy/creds），本地通道已全量覆盖导出面；Gate 3.8 账本 09 行由 dispatcher 本地批次发出，未复现 D6 期 uncovered 插曲。

# 变更提案：ACP 会话压缩入口（session/compact + 能力门控压缩通知）

> module: core | created: 2026-11-07

## 变更原因

dspm 经 ACP 集成 dsh，需要原生压缩语义替代其「摘要续接」兜底（模型生成摘要 → 新会话携带 → 原会话归档，丢失同会话 shadow、KV 缓存复用与自动压力触发）。dsh 侧 CompactionEngine 完整交付——手动 `/compact`、自动触发（压力阈值 / context-overflow 恢复）、LLM checkpoint 摘要、shadow 替换与缓存复用——但仅 dsh 自有 connection 协议可达；ACP 1.4.0 没有 agent 侧压缩请求方法（仅 UNSTABLE 的客户端通知类型），dspm 无法触发或感知压缩。

本变更来源于 `skill-output/dspm-dsh-support-requirements.md` REQ-D4（P1）与 dsh 侧评估结论、Phase 3 回复文档 §4.2：bridge 扩展方法 `session/compact` 复制 `/compact` 的全部包装语义（六失败码经 JSON-RPC error data 携带），并以 client capability 门控的 `compaction_update` 通知补齐「自动压缩纯 log-only、无客户端面」的缺口。Phase 3 回复中「通知形态待 dspm §6 答复」的设计输入按 capability 门控消解：dsh 实现对两种答复均兼容——客户端声明 `session.compaction` 能力才收到 UNSTABLE 通知，不声明则纯同步响应（dspm 的选择只决定其客户端是否声明能力，不影响 dsh 侧实现）。

## 变更类型

接口级（新增 ACP bridge 扩展方法；新增 capability 门控的既有通知类型派发；无持久化面变更）

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的场景总览与核心场景详述；新增 S52，并关联 S03、S15、S49、S50、S51。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 新增 §12 会话压缩 ACP 交互规格。
- 影响的业务场景：新增 S52「外部客户端触发会话压缩并感知压缩生命周期」；回归既有 S03 ACP 会话、S15 压缩（自有 UI 通道）、S49 审批策略、S50 技能清单、S51 计划模式。
- 影响的技术架构：`core-system-map.md`（压缩 ACP 入口）、`acp-network-system-map.md`（`session/compact` 方法面、六失败码映射、capability 门控通知派发）与新增 `core-S52-acp-compaction.md`。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 与 `acp-network-deployment-plan.md` 的发布物与部署后检查。
- 影响的 API：新增 ACP bridge 扩展方法 `session/compact`（请求 `{ sessionId }`，无参数——与 `/compact` 无参语义一致；成功响应 `{ result: { compactionId, summarySeq, shadowedCount, shadowedTokenCount, summary } | null }`，`null` 表示无可压缩历史；预期失败经 JSON-RPC internal error + `data: { code: 'busy'|'cancelled'|'changed'|'summary'|'commit'|'persistence' }` 携带，message 复用 `/compact` 的人类可读文本）。新增能力门控通知派发：客户端 initialize 声明 `clientCapabilities.session.compaction` 时，`compaction/start` / `compaction/end` 持久事件派生 `compaction_update`（in_progress / completed 含摘要块 / failed 含错误文本）经既有 `session/update` 通道发送；不声明则零通知。ACP 1.4.0 无压缩请求标准方法，扩展方法属性在文档明示。
- 影响的 DB 表：无；`compaction/*` 事件与 shadow 替换自 S15 存在，本变更零新增事件类型、零持久化格式变更，`SessionEventMap` 不变，Session format 维持 4。
- 影响的编排测试：无。
- 影响的测试规格：新增 `logos/resources/test/core-S52-test-cases.md`；更新 `logos/resources/test/smoke/acp-network-smoke-test-cases.md`（SMOKE-acp-network-06）；复用 S03、S15、S49、S50、S51 既有回归用例。
- 实现期交付物：`packages/acp` 中英文 README 与 JSDoc、受影响包文档、keyless ACP 快照、`docs/upgrade-guide/<发布版本>/acp-compaction/` 中英文升级指南条目（扩展方法语义、六失败码 data.code 词表、capability 门控通知、UNSTABLE 属性与压缩服务缺席 fail-loud 行为；版本号随发布期确定）。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费包含 `session/compact` 与压缩通知的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物。本变更零新增持久化数据（复用 S15 既有 `compaction/*` 事件），回滚无数据兼容问题；回滚后旧构建不认识 `session/compact`，客户端调用得 method not found（-32601）。
- 是否需要 smoke：是
- smoke 要求：真实 ACP 网络会话上触发压缩（需要真实模型产历史，冒烟通道已有真实模型往返），验证同步响应结构、busy 竞态分支、压缩服务缺席 fail-loud 记录；声明 compaction 能力的客户端核对 `compaction_update` 派发，未声明客户端核对零通知。

## 变更概述

在 `AcpBridge` 暴露 dsh 会话压缩的编程入口：

1. **同步方法（扩展面）**：`session/compact { sessionId }` → bridge 校验归属与参数后经 `AcpSession.compact()` 执行：读 `ctx.get('compaction')`（缺席 internal error fail-loud，说明缺装配，不静默降级），以 bridge 自铸的 `CommandId`（opaque branded string，记入 `compaction/start` / `compaction/summary` / `compaction/end` 三元组的 `sourceCommandId`）调用 `compactNow(agent, signal, sourceCommandId)`——完全复制 `/compact` 的包装语义：引擎经 `runMaintenance` 在真实空闲相位启动（活跃 turn 或进行中维护任务 → `busy`）、caller 取消（JSON-RPC 请求取消）→ `cancelled`、选择段变化 → `changed`、摘要不可用 → `summary`、提交阶段失败 → `commit`、持久化失败 → `persistence`；六码为 `ManualCompactionError.code` 闭联类型属性，经 JSON-RPC internal error 的 `data.code` 携带、message 复用 `/compact` 人类可读文本。压缩期间新到 prompt 被 FIFO 接受并在维护结算后启动（引擎既有语义）；压缩是 durable 事务（`compaction/start` 锁至 `compaction/end`），失败尝试留痕日志。成功响应携带结果统计与摘要内容块；无可压缩历史合法返回 `{ result: null }`（非错误）。
2. **能力门控通知（既有 UNSTABLE 类型派发）**：bridge 在自己的 initialize handler 捕获 `clientCapabilities`；`session.compaction` 在场时 `AcpSession.onSessionEvent` 由持久事件派生通知——`compaction/start` → `{ compactionId, status: 'in_progress' }`；`compaction/end` 无 error → `completed`（summary 取同一 compactionId 的前置 `compaction/summary` 事件内容块）；`compaction/end` 带 error → `failed`（error 文本）。手动与自动压缩共用同一事件序列，声明能力的客户端由此首次获得自动压缩的客户端面（今日纯 log-only）。`cancelled` 状态不经通知表达（日志的 end+error 不区分类别，bridge 不合成事件），仅出现在同步错误 data.code。`compaction_summary_chunk` 不发送（dsh 摘要整段落日志，无增量块）。
3. **边界**：`/compact` 命令、web 自有 UI 通道与自动触发策略不变（压力阈值仍部署配置所有）；压缩的区域选择、保留策略、摘要生成全部复用引擎实现，bridge 不新增策略；`compaction/prune`（模型无关修剪）不派生通知（与摘要压缩不同源，观察者无消费诉求）；dspm 的 UNSTABLE 答复只决定其客户端是否声明能力——不声明即纯同步语义，dsh 实现与答复无关。

模型可见 ⟺ 已记录不变：通知全部由持久事件派生，bridge 不合成、不缓存；无 `SESSION_FORMAT_VERSION` 影响。

## 复用测试 ID

- ST-S03-01 / ST-S03-02 — 回归 ACP initialize→prompt 主链路与取消。
- S15 既有用例 — 回归 `/compact` 命令、自动触发与自有 UI 通道不变。
- UT-S49-01 / UT-S49-05 — 回归 configOptions 面与 resume 广告结构不变。
- UT-S50-01 / UT-S50-05 — 回归 skills_list 方法面与零事件副作用。
- UT-S51-01..06、ST-S51-01 — 回归计划模式面与评审映射不受影响。
- SMOKE-acp-network-01..05 — 保留既有五条网络冒烟回归。

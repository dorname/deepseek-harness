# 变更提案：会话导出经 ACP 流式拉取（extension 方法三件套 + 拉式分块）

> module: core | created: 2026-11-09

## 变更原因

dspm REQ-D8（会话导出经 ACP 或开放服务间鉴权）在回复文档 §8 决策变更（2026-11-08，用户逐项确认）定稿为**路径 (i)：新增 dsh 扩展方法沿 ACP 连接流式返回会话导出**，纯协议面扩展、stdio 本地形态同样可用；HMAC token 鉴权分支（路径 ii）留作后手。现状缺口经核验：会话导出唯一入口是 host webserver 上的 `GET /api/session.export`（ZIP：根日志 JSONL + subagent 日志 + 附件，browser-auth 鉴权，`packages/session-query/session-log-export/src/index.ts:108-169`）——仅私有协议可达；ACP 连接（stdio 本地或 acp-network token 鉴权）没有任何导出方法，dspm 只能自建消息级镜像（REQ-D8 兜底）。

传输事实（本轮调研钉死）：两条 ACP 传输（ndJSON stdio、WebSocket 文本帧）上的 JSON-RPC 只承载 JSON 文本，ZIP 不能进单条 response；且 `session/update` 通知通道无背压语义（bridge notify 失败 warn-and-continue，`bridge.ts:205-215`）、`SessionUpdate` 联合是 SDK 1.4.0 从 schema 生成的封闭类型（无 declaration merging）。生产者侧完全可复用：`streamSessionLogZip`/`sessionLogZipEntries`（`session-log-export/src/archive.ts:545/:347`）是传输无关的 ZIP 字节流生产者，自带 fflate 分条 DEFLATE、64 KiB push 分块（代理对安全）、`ResponseCapacityGate` pull 式背压、`AbortSignal.any` 取消与取消时 `zip.terminate`（绝不产出截断档案）。

**形态决策（实现期定案，覆盖调研初稿的「通知流式」措辞）**：采用**拉式分块读取**（`export_begin` → `export_read` × N → `export_cancel` 三方法）而非 agent→client 通知推送。理由：(a) 背压确定性——每次 read 至多 `exportChunkBytes` 字节，消费节奏完全由客户端掌握，不依赖传输写完成这一弱信号；(b) 断线可重启——导出状态是 per-connection 服务端游标，客户端重连后重新 begin 即可，无半途通知流需要重放；(c) 测试确定性——纯 request/response，无通知交错；(d) 零新增通知类型——`SessionUpdate` 封闭联合与通知派发链零触碰。§8 决策的「沿 ACP 连接流式返回」由分块响应序列承载；措辞中的「ZIP 条目」落实为与 HTTP 路由完全相同的 ZIP 容器字节流（entry 边界对标准 unzip 消费者可见，逐条目自定义框架需新造工件契约且丢失全部生产者复用，已否决）。

## 变更类型

接口级（ACP wire 新增三个 dsh 扩展方法，SDK 面零改动）+ 代码级（dsh-acp bridge 导出模块与 Config 字段）；无持久化面、无会话事件面变更。

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 场景总览与核心场景详述新增 S55，并关联 S26（既有导出）、S03（ACP 主链路）。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 新增 §15 会话导出经 ACP 规格。
- 影响的业务场景：新增 S55「外部客户端经 ACP 流式拉取会话导出」；回归既有导出（S26 web 面）、S49–S54 既有 ACP 方法面与 S03 主链路。
- 影响的技术架构：`core-system-map.md` 新增 §20 会话导出面；`acp-network-system-map.md` 新增会话导出方法面（三方法契约、错误词表、生命周期与安全可见性声明）。
- 影响的部署方案：`core-01-deployment-plan.md` 新增 §十七；`acp-network-deployment-plan.md` 新增导出 staging 验证与 dspm 部署指引。
- 影响的 API：`dsh-acp` bridge 新增三个扩展方法（注册于 `bridge.ts` 实现表，与 `session/skills_list`/`session/compact` 同构，`session/` 前缀 + snake_case 命名）：`session/export_begin { sessionId, includeDescendants? }` → `{ exportId, filename }`（owned-session 校验 → flush 活日志 → 预读根日志，缺失即域错误，任何字节产生前应答）→ 服务端持有拉式游标；`session/export_read { exportId }` → `{ data: <canonical base64>, eof }`（每次至多 `exportChunkBytes` 原始字节，eof 为终态交付、游标即删）；`session/export_cancel { exportId }` → `{}`（abort 生产者、游标即删）。错误词表经 `data.code`：`not_found`（根日志缺失）/ `export_failed`（流中失败，净化消息）/ `unknown_cursor`（未知或已终结游标，invalid params）；未知 sessionId 与服务缺席沿用既有 invalid params / internal fail-loud 语义。`dsh-acp` Config 新增两个经校验字段：`exportChunkBytes`（默认 262144，16384–4194304 之外加载即失败）与 `exportCompressionLevel`（0–9，默认 6）；`peerDependencies` 增补可选 `sessionQuery` 与 `attachments`（`ctx.get` 读取，缺席 internal error fail-loud）。零新增通知类型、零新增 capability 要求（客户端按需调用，未部署版本得 methodNotFound，天然向后兼容）。
- 影响的 DB 表：无；零新增会话事件类型（导出只读日志：flush 持久化的是已记录事件的落盘，不产生新事件），`SessionEventMap`、Session format 4 不变；模型可见 ⟺ 已记录不变量保持（导出不产生任何模型可见输入）。
- 影响的编排测试：无。
- 影响的测试规格：新增 `logos/resources/test/core-S55-test-cases.md`；更新 `logos/resources/test/smoke/acp-network-smoke-test-cases.md`（SMOKE-acp-network-09，纯方法调用无需交互握手，staging 可执行）；复用 S26/S03/S49–S54 既有回归 ID。
- 实现期交付物：bridge 导出模块单测、keyless 快照新场景 `snapshots/acp/session-export/`（快照 harness 新增导出 op，结构化断言 wire 契约）、ST 网络组合全链路、SMOKE-acp-network-09 接入 protocol-smoke.ts 与统一 dispatcher（含账本行）、`dsh-acp` 与 `session-log-export` 中英 README 更新（含 dsh-acp README 范围行修订）、`docs/upgrade-guide/<发布版本>/acp-session-export/` 中英文三元组、config-catalog 重生成。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费含导出方法的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物。零新增持久化事件类型，回滚无迁移；导出方法在旧构建上不存在（methodNotFound），会话数据单向兼容，旧构建读取本版日志无损。
- 是否需要 smoke：是
- smoke 要求：ACP 会话内导出往返——创建会话驱动若干事件 → `export_begin` → `export_read` 至 eof → 解包 ZIP 断言 `session.v4.jsonl` 含驱动事件 → cancel 后 read 得 `unknown_cursor`（SMOKE-acp-network-09；纯方法调用无交互握手，staging 具备条件即执行，不满足时按 skip 语义如实记录）。

## 变更概述

1. **拉式导出三方法（bridge 扩展面）**：`session/export_begin` 在 owned-session 校验后 flush 活跃日志、预读根日志文本（404 语义在任何字节产生前应答），经 `sessionLogZipEntries` + 既有 fflate 管线创建 per-connection ZIP 字节流游标；`session/export_read` 逐次拉取至多 `exportChunkBytes` 字节并 canonical base64 编码返回，eof 即终态交付并删除游标；`session/export_cancel` abort 生产者（复用 `zip.terminate` 语义，绝不产出截断档案）并删除游标。导出内容与 HTTP 路由完全同工件（根日志 + 血缘 subagent 日志 + 附件，`includeDescendants` 语义一致）。
2. **背压与生命周期**：每次 read 至多交付一个配置分块，生产者由既有 `ResponseCapacityGate`（64 KiB HWM）按 `desiredSize` 门控——慢客户端不会积压；每条连接的游标注册表随连接 quiesce 整体 abort（连接级生命周期），显式 cancel 或 eof 即时释放，无 TTL 魔法；同一会话允许多个独立快照导出（与 HTTP 路由语义一致）。
3. **安全与可见性（声明的收紧面）**：授权模型是连接级 owned-session（bridge 会话表即授权边界，与既有方法一致）；导出交付的是**完整原始会话日志**（含内部事件、工具输出、subagent 日志与附件字节），严格多于投影 wire 视图——该可见性与浏览器用户经 `/api/session.export` 所得一致（browser-auth 同级信任：stdio 本地 / acp-network HMAC token），在规格与升级指南中显式声明，不引入脱敏选项（与 HTTP 路由零脱敏一致）。

## 复用测试 ID

- 既有 `session-log-export` archive 套件（`archive.host.spec.ts`）— 生产者行为（分块、代理对、背压、取消终止、fail-loud）不受新消费者影响，回归运行。
- UT-S49..S54 既有面与 ST-S03-01/02 — 既有 ACP 方法面与主链路不受第三组扩展方法注册影响。
- SMOKE-acp-network-01..08 既有回归；ST-S52-01（真实 API 压缩）证明的组合面在导出方法注册后复跑聚焦回归。

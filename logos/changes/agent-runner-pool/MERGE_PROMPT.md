# 合并指令

## 变更提案
- 提案名称：agent-runner-pool
- 提案目录：logos/changes/agent-runner-pool/

## 提案内容

# 变更提案：agent-runner-pool（M3 执行池）

> module: core | created: 2026-10-08

## 变更原因

来自多用户与集群落地方案（`logos/resources/reference/note/2026-10-06-multi-user-and-cluster-plan.md`）的 M3 里程碑：M2（shared-persistence-backends，已归档）把会话世代、域 KV、附件/溢出落到共享 Postgres 并给出每用户命名空间，但执行仍是「每用户一个本地 Host 进程」——G2 的 1/2（接入层多副本、执行池化）尚未开始。当前约束：会话的活跃 Agent、assistant-stream 帧、终端/jobs 全部进程本地（盘点 A6-A8）；任一节点无法服务其他节点属主会话的浏览与控制，runner 崩溃即会话停摆。M3 按 §7 落执行池四件事：会话租约（跨节点单写者）、队列派发（复用 durable inbox 投影接续）、流中继（runner→副本的事件/帧转发）、终端/jobs 的属主亲和（信息面），达成 G2 的 1/2/3。

## 变更类型

需求级（新增场景 S37–S39 + 架构 + 部署 + 测试 + smoke + 代码）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（三、场景总览追加 S37–S39；四、核心场景详述新增；5.3 不做清单修订）
- 影响的功能规格：`core-01-feature-design.md`（ADDED S37–S39 交互规格）
- 影响的业务场景：S37（会话租约的获取/续约/竞争排除/过期接管）、S38（队列派发与 inbox 接续）、S39（流中继跨副本实时）
- 影响的部署方案：`core-01-deployment-plan.md`（拓扑加 runner/副本角色、环境变量、检查清单、冒烟方案追加 SMOKE-core-14/15）
- 影响的 API：无（库/插件型项目，沿用既有先例不产 `api/`；租约/队列/中继 DDL 在架构 delta 中定稿）
- 影响的 DB 表：新增（`session_leases` 租约、`agent_dispatch_queue` 派发队列、`stream_relay_log` 中继日志）——DDL 归架构 delta
- 影响的编排测试：无（非 API 编排项目）
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（追加 SMOKE-core-14/15）

新组件（5 个新包，全部实现新 Service Definition 或并列 Provider，不改既有缝签名与 `agent-loop`）：

1. `packages/core/session-lease`（`@deepseek-ai/dsh-session-lease`）：会话租约 Service Definition（`ctx.sessionLease`）——`acquire(sessionId, owner, ttl)` / `renew` / `release` / `ownerOf` / `waitLost`。对应 JSONL 后端 single-writer claim 的跨节点版（方案 B8）：`agent-loop` 不感知租约，调用方在启动 Agent 前获取、`waitLost` 触发即 `agent.cancel()`。
2. `packages/core/session-lease-postgres`（`@deepseek-ai/dsh-session-lease-postgres`）：租约表 Provider——心跳续约、过期接管为单条原子 `UPDATE ... WHERE lease_expires_at < now()`，接管恰一胜者。
3. `packages/core/stream-relay`（`@deepseek-ai/dsh-stream-relay`）：流中继 Service Definition（`ctx.streamRelay`）——`publish(sessionId, record)` / `subscribe(sessionId, fromSeq)`（record = `session/event` 或 `agent/assistant-stream` 帧的序列化形态），按 seq 单调递增。
4. `packages/core/stream-relay-postgres`（`@deepseek-ai/dsh-stream-relay-postgres`）：中继日志表 + PostgreSQL `LISTEN/NOTIFY` 唤醒 + 序号追赶的 Provider——NOTIFY 仅作唤醒信号（载荷上限 8000 字节），记录本体走共享表。方案原文的 Redis pub/sub 是该缝的另一 Provider，按「不自创协议、零新增基础设施依赖」裁剪延后（记录于不做清单）。
5. `packages/core/agent-dispatch`（`@deepseek-ai/dsh-agent-dispatch`）：派发队列 + runner 编排——队列表（会话 id 去重）+ `publish(sessionId)` + Runner 编排循环（取队列 → `sessionLease.acquire` → `agents.resume`（durable inbox 投影接续，方案 B3）→ `waitLost` 即 `agent.cancel` → 空闲 release）。定义/提供者/消费者三层在本包内闭环（队列仲裁语义与租约表同库绑定）。

既有包改动（小）：

- `packages/api/session-controller`：history/follow 数据面加 stream-relay 增量源——非属主副本冷读共享层后从 relay 追加 live 事件与 assistant-stream 基线，浏览器 follow 语义不变（方案 A8 的新适配器路径，不改事件语义）。

## 部署影响

- 是否需要部署：是
- 部署原因：验收标准要求「kill 正在执行的 runner，其他节点接续」与「两个副本同看一会话流式实时」——需在本地 staging 起共享 Postgres（复用 M2 免 root 嵌入式二进制）+ runner 进程与副本进程（库级驱动，先例同 M2 staging driver）
- 影响环境：本地 staging
- 是否涉及数据迁移：否（全部新表新包；共享层既有表不动）
- 是否需要回滚预案：是（停 runner/副本进程；staging 租约/队列/中继表随集群数据目录销毁）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

本次变更为 M3 执行池：新增 `session-lease`（跨节点会话单写者租约，心跳续约、过期接管恰一胜者，`agent-loop` 零感知——租约在「启动 Agent 前获取、丢失即 cancel」的外层）、`session-lease-postgres`（租约表的原子接管）、`stream-relay` + `stream-relay-postgres`（`session/event` 与 assistant-stream 帧的跨节点中继：共享表单调 seq + `LISTEN/NOTIFY` 唤醒）、`agent-dispatch`（派发队列 + runner 编排循环：取队列→取租约→`agents.resume` 从 durable inbox 投影接续→丢租约 cancel）；`session-controller` 的 follow 数据面加 relay 增量源，使非属主副本可为浏览器提供同一会话的实时流。

范围裁剪（方案原文授权内）：中继介质用 PostgreSQL `LISTEN/NOTIFY`（零新增基础设施依赖，嵌入式二进制测试基建复用 M2），Redis pub/sub 作为该缝的后续 Provider 延后；终端/jobs 亲和他 M3 落「属主信息面」——`sessionLease.ownerOf(sessionId)` 暴露会话属主节点供路由决策，PTY 进程远程化（ssh 式，方案 B5 长期路径）延后；派发队列消费者为库级 Runner 编排（staging driver 驱动双 runner 进程），Web/API 副本无状态化与 K8s 编排（方案 §9）不在本里程碑。测试与验收沿用 M2 基建：`@embedded-postgres/linux-x64` 免 root 真实服务器，二进制缺失显式 skip；验收含 kill-runner 接管、双副本同看流、租约竞争排除（测试注入）。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-session-leases.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-session-leases.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S38-dispatch-continuation.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/prd/3-technical-plan/2-scenario-implementation/core-S38-dispatch-continuation.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-stream-relay.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-stream-relay.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S37-S39-test-cases.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/test/core-S37-S39-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/agent-runner-pool/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(agent-runner-pool): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive agent-runner-pool`。

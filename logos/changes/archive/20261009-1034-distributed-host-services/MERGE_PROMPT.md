# 合并指令

## 变更提案
- 提案名称：distributed-host-services
- 提案目录：logos/changes/distributed-host-services/

## 提案内容

# 变更提案：distributed-host-services（M4 Host 本地服务分布式化）

> module: core | created: 2026-10-09

## 变更原因

来自多用户与集群落地方案（`logos/resources/reference/note/2026-10-06-multi-user-and-cluster-plan.md`）的 M4 里程碑：M3（agent-runner-pool，已归档）交付了租约/派发/中继，G2 的 1/2/3 达成；但 Host 本地服务仍是进程本地——schedule 到期计算绑定在单一 Host 的内存 timer（盘点 A6），webhook 入口在单 Host 进程内直接创建 Workspace Session（A9），插件热重载面向单机 profile 目录（A10）。多副本部署下这三种形态分别产生：提醒在副本间重复投递或随 Host 死亡丢失、webhook 事件被多个副本各建一个会话、配置分发无镜像语义。M4 按 §8 落四件事——schedule 到期计算移到共享库（`FOR UPDATE SKIP LOCKED` 恰一取用）、webhook 入口无状态化（签名校验后只写队列）、profile 用户层共享只读挂载 + 集群禁用 HMR、runner 按会话粒度排空——达成 G2 的 4/5。

## 变更类型

需求级（新增场景 S40–S42 + 架构 + 部署 + 测试 + smoke + 代码）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（三、场景总览追加 S40–S42；四、核心场景详述新增；5.3 不做清单修订）
- 影响的功能规格：`core-01-feature-design.md`（ADDED S40–S42 交互规格）
- 影响的业务场景：S40（共享 schedule 到期恰一交付、不重复不丢）、S41（webhook 入口无状态化恰一建会话）、S42（runner 排空与滚动升级）
- 影响的部署方案：`core-01-deployment-plan.md`（拓扑加共享 schedule/webhook 角色、环境变量、检查清单、冒烟方案追加 SMOKE-core-16/17/18）
- 影响的 API：无（库/插件型项目，沿用既有先例不产 `api/`；共享表 DDL 在架构 delta 中定稿）
- 影响的 DB 表：新增（`schedule_due` 到期任务、`webhook_events` 入口事件）——DDL 归架构 delta
- 影响的编排测试：无（非 API 编排项目）
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（追加 SMOKE-core-16/17/18）

新组件（3 个新包，全部为并列 Provider/编排扩展，不改既有缝签名、不动 `ScheduleService` 单机语义与 `agent-loop`）：

1. `packages/schedule/schedule-dispatch`（`@deepseek-ai/dsh-schedule-dispatch`）：共享 schedule 的到期派发循环——`schedule_due` 行由创建方写入（每任务一行、`next_due_at` 单调推进），runner 循环以 `FOR UPDATE SKIP LOCKED` 取到期行（并发取用恰一），取会话租约后恢复会话投递提醒。「重启后恢复」由表行天然承载；「仅补最近一次错过的 recurring」由 next-due 推进语义钉住（A6 行为契约不变，只换触发器）。
2. `packages/webhook/webhook-ingress`（`@deepseek-ai/dsh-webhook-ingress`）：webhook 入口无状态化——签名校验通过后把事件写入共享 `webhook_events` 表并 `NOTIFY`，返回即时受理；消费循环恰一取事件、创建 Workspace Session、把会话 id 投入既有 `agent-dispatch` 队列执行（A9 的入口/执行解耦）。
3. `packages/core/agent-dispatch`（既有包小改）：`drain(signal)` 排空——停止取队列、停止租约心跳（租约自然过期被其他 runner 接管）、等待 in-flight drive 到 turn 边界结束后返回；滚动升级按会话粒度排空（方案 §8-4）。

既有包改动（小）：

- `packages/boot/hmr`：新增集群只读配置检测——进程环境声明 `DSH_CONFIG_READONLY=1`（集群共享只读挂载语义）时，HMR 插件 fail-closed 拒绝启用（headless/SDK profile 已有禁用先例，A10）。

## 部署影响

- 是否需要部署：是
- 部署原因：验收标准要求「两副本 + 两 runner 下提醒不重复不丢、webhook 恰一建会话、滚动升级中会话不中断」——需在本地 staging 起共享 Postgres（复用 M2/M3 免 root 嵌入式二进制）+ 双 runner/双副本进程与一次滚动升级演练
- 影响环境：本地 staging
- 是否涉及数据迁移：否（全部新表新包；共享层既有表不动）
- 是否需要回滚预案：是（停 runner/副本进程；staging schedule/webhook 表随集群数据目录销毁）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

本次变更为 M4 Host 本地服务分布式化：新增 `schedule-dispatch`（共享库到期行 + `FOR UPDATE SKIP LOCKED` 恰一取用 + 租约约束下投递提醒，「重启后恢复」「仅补最近一次错过」语义钉住）、`webhook-ingress`（签名校验 → 队列表 → 消费循环恰一建 Workspace Session 并入执行池队列）、`agent-dispatch.drain()`（滚动升级按会话粒度排空：停取队列、停心跳、等 turn 边界）；HMR 在 `DSH_CONFIG_READONLY=1` 的集群只读形态下 fail-closed 禁用。profile 镜像化（固定层烘焙 + 用户层共享只读挂载）作为 staging 部署演练的形态要求落地，不新增运行时缝。

范围裁剪（方案原文授权内）：schedule 分布式版为并列 Provider——未配置共享库时既有 `ScheduleService` 单机形态行为不变，两者不混用；webhook 消费循环复用 agent-dispatch 的队列/租约原语而不新建编排器；滚动升级的「发布前跑 `test:snapshot` 全量」属既有 CI 门不新增；K8s Operator 编排（方案 §9）仍不在范围。测试与验收沿用 M2/M3 基建：`@embedded-postgres/linux-x64` 免 root 真实服务器，二进制缺失显式 skip；验收含双 runner 恰一交付、webhook 恰一建会话、排空后接管续跑。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/2-scenario-implementation/core-S40-schedule-dispatch.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/prd/3-technical-plan/2-scenario-implementation/core-S40-schedule-dispatch.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S41-webhook-ingress.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/prd/3-technical-plan/2-scenario-implementation/core-S41-webhook-ingress.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/2-scenario-implementation/core-S42-drain-rolling-upgrade.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/prd/3-technical-plan/2-scenario-implementation/core-S42-drain-rolling-upgrade.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S40-S42-test-cases.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/test/core-S40-S42-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/distributed-host-services/deltas/test/smoke/core-smoke-test-cases.md`
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
   git add -A && git commit -m "docs(distributed-host-services): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive distributed-host-services`。

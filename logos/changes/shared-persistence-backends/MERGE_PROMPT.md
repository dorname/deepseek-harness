# 合并指令

## 变更提案
- 提案名称：shared-persistence-backends
- 提案目录：logos/changes/shared-persistence-backends/

## 提案内容

# 变更提案：shared-persistence-backends（M2 共享持久层）

## 变更原因

来自多用户与集群落地方案（`logos/resources/reference/note/2026-10-06-multi-user-and-cluster-plan.md`）的 M2 里程碑：M1（user-fleet-gateway，已归档）用「进程 + 每用户 `$DSH_HOME`」达成单机用户隔离；但数据仍锚在各自本地盘上——会话世代、域 KV、附件都随单机存亡，节点无共享层，G1-3（数据命名空间分离）只靠目录物理隔离，G2-3（持久层集中）尚未开始。M2 要把三条持久化缝（`SessionPersistence`、storage KV、attachment/spill）各落一个共享后端，并把每用户命名空间从「目录隔离」升级为「共享层内的键前缀隔离」，为 M3 执行池提供基础设施。

## 变更类型

需求级（新增场景 S34–S36 + 架构 + 部署 + 测试 + smoke + 代码）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（三、场景总览追加 S34–S36；四、核心场景详述新增；5.3 不做清单修订）
- 影响的功能规格：`core-01-feature-design.md`（ADDED S34–S36 交互规格）
- 影响的业务场景：S34（共享会话世代读写与崩溃恢复）、S35（共享域数据与每用户命名空间）、S36（共享附件存取）
- 影响的部署方案：`core-01-deployment-plan.md`（拓扑加共享 Postgres 节点、环境变量、构建命令、检查清单、冒烟方案）
- 影响的 API：无（库/插件型项目，沿用既有先例不产 `api/`；Postgres DDL 在架构 delta 中定稿）
- 影响的 DB 表：新增（`sessions` 元数据/代际指针、`session_generations` 世代字节、域 KV 表、附件大对象表）——DDL 归架构 delta
- 影响的编排测试：无（非 API 编排项目）
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（追加 SMOKE-core-12/13）

新组件（3 个新包，均实现既有缝，不改核心缝签名）：

1. `packages/session/session-persistence-postgres`（`@deepseek-ai/dsh-session-persistence-postgres`）：`SessionPersistence` 缝的 Postgres 后端——元数据 + 代际指针在表，世代事件字节随代际行存储（blob 列分块）；必须跑通既有缝契约套（`runPersistenceContract` / `runLiveWritePathContract`）。
2. `packages/storage/storage-postgres`（`@deepseek-ai/dsh-storage-postgres`）：与 `storage-sqlite` 并列的共享 KV 后端；`storage-domain` 不变，schedule/workspace/投影缓存等域自动获得共享承载。
3. `packages/attachment/attachment-postgres`（`@deepseek-ai/dsh-attachment-postgres`）与 `packages/spill/spill-postgres`（`@deepseek-ai/dsh-spill-postgres`）：附件/溢出的共享存储后端（缝已抽象，照 `attachment-local`/`spill-local` 契约）。

既有包改动（小）：

- `packages/storage/storage-domain`：提供方层为每个域 unit 派生用户专属命名空间（unit 名后缀派生自 fleet subject `DSH_FLEET_USER_ID`，G1-3），域实现与 KV 后端零感知；无注入时使用默认命名空间，行为与现状一致。

## 部署影响

- 是否需要部署：是
- 部署原因：验收标准要求「双节点指向同一共享层」——需在本地 staging 起一个共享 Postgres（`@embedded-postgres/linux-x64` 免 root 二进制）+ 两个指向同库的 dsh Host 实例走通双节点与命名空间 smoke
- 影响环境：本地 staging
- 是否涉及数据迁移：否（新后端为并列选项；既有 JSONL 世代文件与 `SESSION_FORMAT_VERSION` 迁移链原样保留，指向 Postgres 的新部署从空库开始）
- 是否需要回滚预案：是（停双实例并保留/清理 staging 库）
- 是否需要 smoke：是

## 变更概述

本次变更为 M2 共享持久层：新增 `session-persistence-postgres`（世代元数据 + 代际指针 + 世代事件字节的 Postgres 承载，通过既有缝契约套约束崩溃一致性与单写者语义）、`storage-postgres`（域 KV 共享后端，`storage-domain` 与各域实现零改动）、`attachment-postgres`/`spill-postgres`（附件与溢出共享承载）；`storage-domain` 提供方统一注入每用户键前缀 `<uid>:`，域实现不感知命名空间（G1-3 在共享层内成立）。

范围裁剪（均记录于方案原文授权内）：全文检索按 §6-3 的「按用户分库」选项（现状每 home 独立 SQLite 即满足，Postgres FTS 集中化延后）；集中凭证 KMS（§6-5「可选」）延后；世代字节先随 Postgres blob 列存储，对象存储拆分（§6-1 的「与」选项）作为后续部署变体，本提案保持「不自创协议、复用缝契约」的既定路线。测试基建引入 `@embedded-postgres/linux-x64` 免 root Postgres 二进制供契约测试与双节点 smoke 使用，二进制缺失时相关用例显式 skip（可见、不假绿）。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/2-scenario-implementation/core-S34-shared-session-generations.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/prd/3-technical-plan/2-scenario-implementation/core-S34-shared-session-generations.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-shared-domain-namespace.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-shared-domain-namespace.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/2-scenario-implementation/core-S36-shared-attachments.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/prd/3-technical-plan/2-scenario-implementation/core-S36-shared-attachments.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S34-S36-test-cases.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/test/core-S34-S36-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/shared-persistence-backends/deltas/test/smoke/core-smoke-test-cases.md`
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
   git add -A && git commit -m "docs(shared-persistence-backends): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive shared-persistence-backends`。

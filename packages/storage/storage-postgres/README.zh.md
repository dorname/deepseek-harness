---
description: "PostgreSQL 存储后端：面向把多个 dsh 节点指向同一共享 KV 介质的宿主与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-storage-postgres

[English](README.md) | 中文

## 概述

`dsh-storage-postgres` 是把所有被路由单元承载在同一个共享 PostgreSQL 数据库中的存储后端，每条记录按行存为一份 JSON 文档，注册名为后端 `postgres`。多个 dsh 节点可以指向同一数据库：建表经 advisory lock 串行化，每用户命名空间由域设施在其上叠加，因此两个节点打开同一域时永远看不到彼此的数据。本包仅运行在宿主侧：不向模型贡献任何提示、工具或 schema，模型与代理循环不会看到它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当部署需要跨多个 dsh 节点共享领域数据（指向同一数据库的用户 fleet），或因运维原因偏好 PostgreSQL 介质时使用本包；没有此类数据库的单机组合应继续使用 `storage-sqlite`。

### 何时选择

当介质必须活过单机、超出单机范围时选择它：数据库（而非本地盘）持有数据。与 SQLite 后端一样每个键恰好映射到一行，但驱动是异步的、介质是独立的 服务进程，因此 `version-mismatch` 或连接失败表现为 open 被拒绝，而不是本地文件错误。

### 配置

两个字段：连接串与连接池大小。数据库（与 schema）必须已存在；后端在连接时创建自己的表。

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-postgres'
  config:
    connectionString: postgres://dsh:secret@db.internal:5432/dsh
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: postgres
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `connectionString` | 必填 | 共享数据库的 `postgres://` 连接串 |
| `max` | `1` | 连接池大小；域层按单元串行化写入，只有大量并发读者时才需要调大 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-storage-postgres)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 可观察行为

全新数据库在同一事务内盖上物理布局版本戳；盖有其他版本戳的数据库拒绝 `version-mismatch`——不做迁移，预发布立场。已存格式版本与描述符不同的单元拒绝 `version-mismatch`。单元与表名不符合存储 hub 的单元名模式时拒绝，物理标识符超过 PostgreSQL 63 字节上限时同样拒绝。失败携带稳定的 `StorageError` 代码，写入操作完成后即已持久化。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

后端是单连接池（`postgres`/postgres.js）上的按行文档布局，设计目标是按键更新为单条语句、且 DDL 跨节点无竞态。

### 设计要点

- **按行文档。** 每个单元表物化为物理表 `u_<unit>_<table> (key TEXT PRIMARY KEY, value TEXT)`，`value` 列存记录的 JSON 文本；全局单例放在共享表 `unit_globals`——与 SQLite 后端的物理习惯互为镜像。
- **单语句原子性。** 每个写原语是一条语句，PostgreSQL 的单语句原子性即满足 KV 契约；写序仍由调用方负责（域层的写链）。
- **DDL 由 advisory lock 串行化。** 每个 DDL 事务先取事务级 `pg_advisory_xact_lock`（共享布局一把、每单元一把），因为同一表名的并发 `CREATE TABLE IF NOT EXISTS` 会在 PostgreSQL 类型目录的唯一索引上崩溃——即使隔着 IF NOT EXISTS 守卫，而「两个 dsh 节点同时指向空共享库启动」正是这个竞态。
- **名字与长度先于 DDL 校验。** 单元与表名必须匹配 `UNIT_NAME_RE`，且每个物理标识符必须落在 PostgreSQL 63 字节限制内；越界一律 loud fail，而不是在静默截断下对撞。
- **版本戳 fail loud。** 物理布局版本存在 `storage_postgres_meta`；单元格式版本存在各单元的 `u_<unit>___unit_meta` 表。盖有其他值的介质拒绝——不做迁移。

### 打开序列

`connectDatabase` 打开连接池并在一个事务内确保共享布局（advisory lock → 版本检查 → `storage_postgres_meta` 与 `unit_globals` → 最后盖新库版本戳）。`kv.open` 在第二个事务内确保单个单元（advisory lock → 单元版本戳 → 记录表），因此两个节点打开同一单元时竞速收敛为一次原子提交。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：后端注册、配置、单元表、单元级 DDL 事务 |
| [`src/schema.ts`](src/schema.ts) | 连接序列、物理布局版本、共享表、标识符助手 |
| [`src/unit.ts`](src/unit.ts) | 单个已打开单元：语句助手、JSON 值解析、关闭 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当本后端的视角不够时阅读这些页面：子系统参考是权威契约，姊妹后端展示其他介质。

- [Storage 子系统](../../../docs/subsystems/storage.zh.md) — 后端契约、域语义与生成的 API。
- [Storage 包地图](../README.zh.md) — 包家族及其仓库位置。
- [SQLite 存储后端](../storage-sqlite/README.zh.md) — 面向本地组合的单文件介质。

-----

<a id="model-experience"></a>
## 模型体验

### 存储的领域记录

#### 模型看到什么

什么都没有。本后端不贡献提示、工具或 schema；它在 `ctx.storage` 之后为宿主侧消费者持久化非会话领域数据。

#### Token 影响

零活请求 token。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制定义本后端何时不适配或需要特别运维关注。它们是当前的包约束，不是任务清单。

- **数据库与 schema 须预先存在** — 后端只建表、不建库；连接或权限失败在首次使用时浮现。
- **无连接重试策略** — 失败的语句立即拒绝；领域数据的重试语义由调用方持有。
- **只有当前物理布局版本可打开** — 盖有其他布局或单元版本戳的介质拒绝而非迁移（预发布立场）。
- **物理标识符上限 63 字节** — PostgreSQL 会静默截断更长的标识符，因此过长的单元或表名直接拒绝而非对撞。

-----

## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。
</details>

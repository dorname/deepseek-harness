---
description: "面向多个 dsh 节点共用同一共享会话库的 PostgreSQL 持久会话后端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-postgres

[English](README.md) | 中文

## 摘要

`dsh-session-persistence-postgres` 是一个持久会话后端:每个会话的头与已提交代际指针存为一行 `sessions` 记录,已提交世代为不可变字节行,最新写入落在 live tail,注册为 `ctx.sessionPersistence`。多个 dsh 节点可指向同一数据库:会话级 advisory lock 仲裁唯一写者,世代发布与指针推进同事务,中断尾永不回读、由下一次写式打开修复。本后端只在宿主侧:不贡献 prompt、工具或 schema,模型与 agent 循环完全不可见。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [延伸阅读](#延伸阅读)
- [模型体验](#模型体验)
- [已知限制与待办](#已知限制与待办)

-----

<a id="使用本包"></a>
## 使用本包

在 profile 的 `cordis.yml` 中加载本后端(仅宿主侧;模型不可见):

```yaml
plugins:
  '@deepseek-ai/dsh-session-persistence-postgres':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_sessions
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `connectionString` | 必填 | 共享会话库的 `postgres://` 连接串 |
| `max` | `4` | 连接池大小;每个打开的写式句柄额外为其会话锁独占一条连接 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-session-persistence-postgres)是每个接受字段及其 JSDoc 的穷尽来源。

### 可观察行为

全新数据库在一个事务内盖物理布局版本戳;其他已戳版本拒绝——不迁移,预发布立场。存储格式版本与本构建 `SESSION_FORMAT_VERSION` 不一致的会话以 `SessionFormatUnsupportedError` 拒绝打开且不留下所有权。重复 create 以 `SessionAlreadyExistsError` 拒绝;他节点持锁期间的写式打开以 `SessionAlreadyOwnedError` 拒绝。追加仅接受连续批次且 resolve 即持久;`flush` 是屏障,把 tail 折叠为新的不可变已提交世代。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本后端是基于单一连接池(`postgres`/postgres.js)的「世代 + tail」布局,跨节点语义全部由数据库本身仲裁。

### 设计概念

- **世代是不可变行。** `session_generations (id, generation, bytes BYTEA)` 存每个已提交世代的事件行;`INSERT` 主键冲突即独占发布失败,是 JSONL 后端 `fs.link` EEXIST 的数据库侧对偶。发布与 `sessions.current_generation` 指针推进同事务,读者永远看不到半个世代。
- **tail 是 live 前缀。** `session_tail (id, bytes TEXT)` 累积已提交世代之后的写入;最后一行无终止符即中断尾——读路径永不回读,下一次写式打开截断修复。已提交世代行永不改写。
- **每会话唯一写者,由数据库仲裁。** 写式句柄在一条专属 reserved 连接上持有 `pg_try_advisory_lock(hashtext(id))`,自构造至 close;进程死亡即连接关闭即锁释放——正是 JSONL 后端用内核文件锁的位置。
- **与各后端一致的校验词汇。** create 头、追加批次、连续性、存储事件词汇、格式版本全部流经 `session-persistence` 缝导出的原语,拒绝行为跨后端逐条一致。
- **连接池在连接期预热。** 每条池连接都在 `connectDatabase` 期间建立(并以一次往返验证),写句柄的锁连接不会在飞行中触发惰性建连,新连接的故障在启动时浮出。

### 写路径

`create` 在进程内登记会话(立即可见,首次 append 或 flush 前在共享库无足迹)。`persistBatch` 首写时在一个事务内物化 `sessions` 行与首个世代,之后向 tail 追加编码行。`flush` 在行锁下把 tail 折叠为 `current_generation + 1` 世代并删除 tail,同事务完成。句柄镜像 JSONL 提供方的运行时:每句柄变更链、带界限批窗的路由 live 缓冲、先排空后释放所有权的 close。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口:`SessionPersistence` 服务——create/open/stat/list、物化、tail 追加、世代发布 |
| [`src/schema.ts`](src/schema.ts) | 连接序列、物理布局版本、三张表 |
| [`src/format.ts`](src/format.ts) | 事件行编解码、中断尾检测、seeded-cut 门 |
| [`src/storage.ts`](src/storage.ts) | 提供方本地句柄与 tracker 运行时:变更链、live 缓冲、teardown |
| [`src/lease.ts`](src/lease.ts) | reserved 连接上的 advisory-lock 写锁 |

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

当本后端的视角不够时阅读:缝契约是权威,兄弟后端展示单机介质。

- [会话持久化缝](../session-persistence/README.zh.md)——各后端实现的服务与句柄契约。
- [Session 包地图](../README.zh.md)——该家族的包及其仓库位置。
- [JSONL 会话后端](../session-persistence-jsonl/README.zh.md)——单机构成的文件系统介质。

-----

<a id="模型体验"></a>
## 模型体验

### 存储的会话事件

#### 模型看到什么

无。本后端不贡献 prompt、工具或 schema;仅为宿主侧消费方在 `ctx.sessionPersistence` 之后持久化会话日志。

#### Token 影响

零 live-request token。

#### KV Cache 影响

无——本后端从不触碰活请求前缀。

-----

## 已知限制与待办

<a id="已知限制与待办"></a>

这些限制界定本后端何时不适用或需要特殊运维关注。它们是当前包约束,不是任务清单。

- **数据库与 schema 必须预先存在**——后端建表不建库;连接或权限故障在首次使用时浮出。
- **无历史世代迁移**——不同于 JSONL 后端的已发布格式迁移,本后端只存当前格式;存储 `format_version` 不匹配直接拒绝而非迁移(预发布立场)。
- **无压缩**——世代字节与 tail 文本原样存储;JSONL 后端的 Zstandard 选项暂无 PostgreSQL 对应。
- **每个写式句柄为其会话锁独占一条池连接**直至 close,`max` 须覆盖预期的并发追加句柄加读者。

-----

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

共享 live-write 契约套的部分断言在 `vi.useFakeTimers()` 窗口内运行、同时等待真实后端 I/O。postgres.js 的 socket 写调度依赖 `setImmediate`,因此本包 spec 通过文件级 `vi.setConfig({ fakeTimers: { toFake: [...] } })` 保持 `setImmediate` 真实;套件的批窗定时器仍被 fake。`connectDatabase` 的连接池预热正是使这已足够的原因:任何连接都不会在 fake-timer 窗口内惰性建立。

</details>

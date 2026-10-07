# delta — core-system-map.md（变更 shared-persistence-backends）

## ADDED — 10. 共享持久层（shared-persistence-backends 引入）

M2 在第 4 节三条持久化缝上各落一个共享 Postgres 后端，并把每用户命名空间从目录物理隔离升级为共享层内的命名空间隔离。核心缝签名（`SessionPersistence`、storage KV、`AttachmentStore`/`SpillStore`）零改动；新包均实现既有缝、以并列后端注册。

### 10.1 组件

| 组件 | 包 | 实现的缝 | 说明 |
|------|-----|---------|------|
| 会话世代 Postgres 后端 | `packages/session/session-persistence-postgres`（`@deepseek-ai/dsh-session-persistence-postgres`） | `SessionPersistence` | 元数据 + 代际指针在表，世代事件字节为代际行内的字节列；复用 `session-persistence` 导出的校验原语（`storage-contract.ts`）保证各后端拒绝行为一致 |
| 共享 KV 后端 | `packages/storage/storage-postgres`（`@deepseek-ai/dsh-storage-postgres`） | `StorageBackend.kv` | 与 `storage-sqlite` 并列注册（名 `'postgres'`）；表结构镜像 sqlite 后端的 `u_<unit>_<table>` 物化习惯，unit 版本戳同语义 |
| 共享附件后端 | `packages/attachment/attachment-postgres`（`@deepseek-ai/dsh-attachment-postgres`） | `AttachmentStore` | 最小实现 `imageLimits`/`validateImage`/`saveImage`/`readImage`；文件流与 request 投影保持缝默认拒绝 |
| 共享溢出后端 | `packages/spill/spill-postgres`（`@deepseek-ai/dsh-spill-postgres`） | `SpillStore` | `saveText` 落共享表，`SpillRef` 仍为后端自造不透明串 |
| 命名空间提供方 | `packages/storage/storage-domain`（既有包小改） | `DomainFacility` | 注入了 fleet 身份的进程把每个域 unit 的名字派生为用户专属命名空间名 |

驱动与测试基建：Postgres 客户端用纯 JS 驱动（`postgres`/postgres.js，不新增原生依赖，沿用 node:sqlite 同级的零编译惯例）；测试与 staging 用 `@embedded-postgres/linux-x64` 免 root 真实服务器二进制，二进制缺失时相关用例显式 skip（不假绿）。

### 10.2 DDL（会话世代，`SESSION_FORMAT_VERSION` 语义不变）

```sql
-- 会话头与代际指针（current_generation 单调，指向最新已提交世代）
CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT PRIMARY KEY,
  format_version     INTEGER NOT NULL,
  header             TEXT NOT NULL,            -- 物化头（lossless JSON）
  current_generation INTEGER NOT NULL DEFAULT 0,
  inherited_event_count INTEGER NOT NULL DEFAULT 0,
  created_at         BIGINT NOT NULL,          -- epoch 毫秒
  updated_at         BIGINT NOT NULL
);

-- 已提交世代：不可变行。(id, generation) 原子 INSERT 冲突即独占发布失败——
-- 对应 JSONL 的 fs.link(staged, current) EEXIST 语义
CREATE TABLE IF NOT EXISTS session_generations (
  id         TEXT NOT NULL REFERENCES sessions(id),
  generation INTEGER NOT NULL,
  bytes      BYTEA NOT NULL,                  -- 整代事件日志字节（与 JSONL 世代文件同构）
  PRIMARY KEY (id, generation)
);

-- 未物化尾：最新世代之后的写入（对应 JSONL 的 live tail）；读路径永不回读中断尾
CREATE TABLE IF NOT EXISTS session_tail (
  id    TEXT PRIMARY KEY REFERENCES sessions(id),
  bytes TEXT NOT NULL                          -- 半行中断以最后一行不含换行符表达
);
```

- **写式互斥**：写式打开在共享库上取会话级锁（`pg_try_advisory_lock(hashtext(id))`），close 释放；不新增原生依赖（JSONL 的跨进程 flock 由 node-addon 承担，Postgres 后端用库原语等价表达）。
- **崩溃恢复**：打开时尾的最后一行不含终止符即中断尾——读路径屏蔽，写式打开按既有 repair 语义截断合成收尾；已提交世代行永不改写。
- **revision token**：`<current_generation>:<tail 摘要>` 形式的后端自造串（`SessionPersistenceRevision` 品牌类型）。
- **独占发布**：`INSERT INTO session_generations` 主键冲突即 `JsonlGenerationTargetConflictError` 同族冲突；世代发布与指针推进在同一事务。

### 10.3 DDL（共享 KV）

```sql
-- 每 unit 一组表，命名与 storage-sqlite 对齐：u_<unit>_<table>
CREATE TABLE IF NOT EXISTS u_<unit>_<table> (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                        -- lossless JSON
);
CREATE TABLE IF NOT EXISTS u_<unit>___unit_meta (  -- unit 版本戳，version-mismatch 拒绝同 sqlite
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version   INTEGER NOT NULL
);
```

### 10.4 DDL（附件/溢出）

```sql
-- 附件对象：属主命名空间内内容寻址；(namespace, sha256) 复合主键
CREATE TABLE IF NOT EXISTS attachment_objects (
  namespace TEXT NOT NULL,                   -- 默认命名空间或用户派生命名空间
  sha256    TEXT NOT NULL,                   -- <hex64>
  bytes     BYTEA NOT NULL,
  size      BIGINT NOT NULL,
  PRIMARY KEY (namespace, sha256)
);

-- 溢出文本：按属主会话分组，引用为自造不透明 id
CREATE TABLE IF NOT EXISTS spill_texts (
  namespace TEXT NOT NULL,
  ref       TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  bytes     TEXT NOT NULL
);
```

### 10.5 每用户命名空间（G1-3 在共享层内成立）

- **注入点**：`DomainFacility`（提供方层）。进程环境注入 `DSH_FLEET_USER_ID`（M1 fleet 管理器已注入）时，每个域 unit 的名字派生为 `<unit>_u<摘要>` 形式的用户专属名（摘要为 subject 的确定性安全编码，满足 `UNIT_NAME_RE`，且避免与普通 unit 名冲突）；未注入时用原名（默认命名空间），行为与现状一致。
- **为何在 unit 名层而非 record key 层**：KV 契约约束 record key 匹配 `[a-zA-Z0-9_-]+`，subject 含 `.` 不能直接做键前缀；unit 名层派生同时让 global 槽位天然按用户分离（每命名空间独立 global），且对全部后端（sqlite/json/postgres/测试替身）统一生效，KV 后端与域实现零感知。
- **附件/溢出命名空间**：对象表以 `namespace` 列承载同一派生规则；引用 id 不透明，消费方无跨命名空间列举/寻址入口。
- **不变式**：命名空间只由提供方从注入身份派生，域 API 键空间在命名空间内闭合；无跨命名空间查询入口（对应需求 5.3 不做清单）。

### 10.6 契约与验收绑定

- `session-persistence-postgres` 必须跑通 `runPersistenceContract` / `runLiveWritePathContract`（`packages/session/session-persistence/tests/`），工厂提供 `{persistence, dispose, reopen, corruptTail}`——`reopen` 用新连接模拟第二节点（跨实例用例不再自跳过），`corruptTail` 向尾行注入半行 JSON。
- `storage-postgres` 以 `storage-domain` 的测试替身惯例对齐（内存/文件后端既有用例为参照），并覆盖双连接命名空间互不可见。
- 附件/溢出后端覆盖存取一致、not found、命名空间隔离。

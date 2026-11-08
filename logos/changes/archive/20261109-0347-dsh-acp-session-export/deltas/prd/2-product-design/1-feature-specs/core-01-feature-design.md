# delta — core-01-feature-design.md（变更 dsh-acp-session-export）

## ADDED — §15 会话导出经 ACP 规格（S55）

在 §14 之后（文档末尾）插入：

```markdown
## 15. 会话导出经 ACP 规格（S55）

### 15.1 导出三方法与 wire 契约

- bridge 在实现表（`bridge.ts`，与 `session/skills_list`/`session/compact` 同构）注册三个 dsh 扩展方法，`session/` 前缀 + snake_case 命名；SDK 面零改动（字符串方法 + params parser 注册路径，泛型 `onRequest<Params, Response>` 重载）。零新增通知类型与 capability 要求——客户端按需调用，旧服务得 methodNotFound，向后兼容天然成立。
- `session/export_begin { sessionId, includeDescendants? = false }` → `{ exportId, filename }`：`requireSession` owned-session 校验（未知 id invalid params，与 compact 一致）→ `flushLiveSessionLog`（活跃会话先落盘，冷读不 flush）→ `readSessionLogText` 预读根日志（`SessionPersistenceNotFoundError` → internal error `data.code: 'not_found'`，净化消息）→ 以预读文本创建 `sessionLogZipEntries` 生产者（`streamSessionLogZip` 同管线：fflate 分条 DEFLATE、压缩级别取 Config）并在 per-connection 游标注册表登记 `{ exportId, reader, abort }`。`filename` 复用 `sessionLogZipFilename`（`dsh-session-<净化id>.zip`）。根缺失与服务缺席（`ctx.get` 读 `sessionQuery`/`attachments`/`sessionPersistence`/`sessions` 任一缺席）均在任何字节交付前应答（fail-loud）。
- `session/export_read { exportId }` → `{ data, eof }`：从游标 reader 拉取至多 `exportChunkBytes` 原始字节，canonical base64（RFC 4648，`content.ts` 既有编解码规范）返回；`eof: true` 为终态交付（`data` 可为空串），游标在响应前即删除。生产者背压由既有 `ResponseCapacityGate`（64 KiB HWM、按字节计数、`desiredSize` 门控）承载：消费节奏完全由 read 序列决定，慢客户端不积压。生产者中途失败（如血缘后代缺失——entries 生成器 fail-loud 抛错）→ internal error `data.code: 'export_failed'`（净化消息，不回显主机路径），游标删除；绝不产出截断档案的字节后被误认为完整。
- `session/export_cancel { exportId }` → `{}`：abort 游标生产者（`streamSessionLogZip` 的 cancel 语义：`zip.terminate()`，消费侧 signal 为 `AbortSignal.any`），游标即删。未知或已终结游标的 read/cancel 一律 invalid params `data.code: 'unknown_cursor'`——终态即删是唯一状态迁移，无部分状态。
- 错误词表（`data.code`，message 复用人类可读文本，全部净化）：`not_found`（根日志缺失）/ `export_failed`（流中失败）/ `unknown_cursor`（未知或已终结游标）；未知 sessionId、服务缺席沿用既有 invalid params / internal 语义（S52 同构）。

### 15.2 Config 与依赖注入

- `dsh-acp` Config 新增两个加载期校验字段（schema 范围外即加载失败，misconfiguration fails loud）：`exportChunkBytes?: number`（每 read 原始字节上限，默认 262144，合法域 16384–4194304；部署旋钮——带宽与往返次数的权衡，非协议常量）与 `exportCompressionLevel?: number`（0–9，默认 `DEFAULT_SESSION_LOG_COMPRESSION_LEVEL` = 6）。HTTP 路由的压缩级别仍由 `session-log-export` 插件 Config 承载——两个面各自归属其插件，映射文档在系统图注记。
- `dsh-acp` `peerDependencies` 增补可选 `sessionQuery` 与 `attachments`（既有 `sessionPersistence`/`sessions` 不变）；方法执行时 `ctx.get` 读取，缺席 internal error fail-loud（optional service 语义既有）。

### 15.3 生命周期与并发

- 一个导出游标是一个生命周期控制器，终态恰四个：eof 交付、流中失败、显式 cancel、连接 quiesce——终态即删，无 TTL、无部分状态、无复活。游标注册表 per-connection：连接 dispose/quiesce 时整体 abort 并清空（连接级资源归属）；`session/close` 不中止该会话的在途导出——begin 时的 flush + 预读已固定快照点，归档内容自洽（时间点快照语义，与 HTTP 下载一致）。
- 同一会话允许多个并发独立快照（每次 begin 独立 flush + 预读），与 HTTP 路由多下载并发语义一致；游标 id 为进程内唯一 opaque 标识（branded，非可猜测序号）。

### 15.4 安全与可见性声明

- 授权边界 = 连接级 owned-session（桥接会话表），与既有 ACP 方法一致；未知会话 id 不可枚举（invalid params 无存在性泄漏）。
- 导出交付完整原始会话日志（含内部事件、工具输出、subagent 日志）与附件字节，严格多于投影 wire 视图。该可见性不是新增暴露：浏览器用户经 `/api/session.export`（browser-auth）取得同一工件；ACP 连接的信任级（stdio 本地进程 / acp-network HMAC token + jti 防重放）与 browser-auth 同级。规格与升级指南显式声明该面，不提供脱敏选项（与 HTTP 路由零脱敏一致）；若未来出现低信任消费形态，属新变更（HMAC 分支路径 ii 留作后手）。
- 导出只读会话数据：flush 落盘的是已记录事件的持久化（既有 flush 语义），不产生新事件类型、不产生模型可见输入——模型可见 ⟺ 已记录不变量、`SessionEventMap`、Session format 4 全部保持。
```

# core S55（外部客户端经 ACP 流式拉取会话导出）— 场景实现

> 来源：变更 `dsh-acp-session-export`。场景来源 `core-01-requirements.md` §S55；功能规格见 `core-01-feature-design.md` §15。

## 导出时序（ACP 连接，拉式分块）

```
ACP 客户端                 ACP bridge                       session-log-export(生产者)
  | export_begin(sessionId)-->|                                 |（ctx.get 服务缺席 → fail-loud）
  |                       归属校验(未知 id → invalid params)     |
  |                       flushLiveSessionLog ----------------->| 落盘已记录事件
  |                       readSessionLogText ------------------>| 根缺失 → not_found（零字节应答）
  |                       创建 entries 生成器 + 游标注册         |
  |<-- { exportId, filename } --|                                |
  | export_read(exportId) ---->| reader.read() ≤ chunkBytes ---->| ResponseCapacityGate(desiredSize)
  |<-- { data, eof:false } ----| canonical base64                | fflate 分条 DEFLATE
  |        … 循环 …             |                                 |
  | export_read(exportId) ---->| 尾块 + eof:true；游标即删        |
  |<-- { data, eof:true } -----|                                 |
  | （此后 read/cancel → unknown_cursor）                        |
```

- 取消路径：`export_cancel` → abort（`zip.terminate`）→ 游标即删 → `{}`；后续 read 得 `unknown_cursor`。
- 连接 quiesce：游标注册表整体 abort + 清空；客户端重连后重新 begin（时间点快照，无续传语义）。

## 生命周期状态

| 状态 | 迁入 | 迁出 |
|------|------|------|
| active | begin 成功（校验 + flush + 预读通过） | eof 交付 / export_failed / cancel / 连接 quiesce |
| （无终态滞留） | 四终态任一 | 游标即删，注册表无残留 |

- 终态即删是唯一状态迁移；无 TTL、无部分状态、无复活。同一会话并发多快照合法（独立 begin 时刻快照）。
- `session/close` 不中止在途导出：快照内容在 begin 的 flush + 预读已固定，归档自洽。

## 组件与契约

- `acp` bridge：三扩展方法注册（实现表，`session/compact` 同构）；`requireSession` owned-session 校验；游标 id 进程内唯一 opaque branded id；Config `exportChunkBytes`（默认 262144，16384–4194304 加载校验）与 `exportCompressionLevel`（0–9 默认 6）；`peerDependencies` 增补可选 `sessionQuery`/`attachments`（`ctx.get`，缺席 internal error fail-loud）。
- `session-log-export`：零改动——`sessionLogZipEntries`/`streamSessionLogZip`/`ResponseCapacityGate`/`sessionLogZipFilename`/`flushLiveSessionLog`/`readSessionLogText` 原样复用；HTTP 路由行为不变（其压缩级别 Config 仍归该插件）。
- 错误词表：`not_found` / `export_failed` / `unknown_cursor`（`data.code`，消息净化）；未知 sessionId invalid params。
- 可见性：交付完整原始日志 + 附件字节（严格多于投影 wire 视图）；授权边界 = 连接级 owned-session；与 `/api/session.export`（browser-auth）同级信任、同工件。

## 边界

- 导出只读会话数据：flush 落盘的是已记录事件（既有语义），零新增会话事件类型、零模型可见输入；`SessionEventMap` 与 Session format 4 不变。
- 慢客户端不积压：read 序列即消费节奏，`ResponseCapacityGate`（64 KiB HWM）按 `desiredSize` 门控生产者；两条传输（ndJSON stdio / WS 文本帧）行为一致。
- 旧构建回滚：导出方法不存在（methodNotFound），零持久化面变化，日志单向兼容。
- 快照：新增 keyless 场景 `snapshots/acp/session-export/`（harness 新增导出 op）结构化断言三方法 wire 契约（方法名/参数/响应形状/错误码）——ZIP 字节含时间戳等易变内容，快照断言结构而非字节。

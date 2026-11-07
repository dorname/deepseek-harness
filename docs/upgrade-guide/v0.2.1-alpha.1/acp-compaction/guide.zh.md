---
kind: upgrade-guide
description: "ACP 暴露显式手动压缩：返回引擎持久结果的 session/compact 扩展方法、按能力协商的 compaction_update 通知，以及会话有活跃工作时的 busy 线上分支。"
---

# ACP 会话压缩

[English](guide.md) | 中文

## 变更

此前 ACP 会话没有压缩界面，客户端无从触发或观察 dsh 上下文压缩。下一版本新增显式界面：

- `session/compact`（请求 `{ sessionId }`，响应 `{ result }`）运行该会话已组合的压缩引擎一次，并返回其持久结果——`compactionId`、`summarySeq`、`shadowedRange`、`shadowedCount`、`shadowedTokenCount` 与 `summary` 块——历史不可压缩时返回 `{ result: null }`。ACP 1.4.0 未定义压缩请求，因此该方法是一个 dsh 扩展，带显式参数解析器。
- 压缩进度经 `session/update` 的新变体 `compaction_update` 下发，由 `initialize` 时声明的 `session.compaction` 客户端能力协商：已声明的连接会收到有序的一对通知——`in_progress`，随后是携带摘要块的 `completed` 或携带错误文本的 `failed`——由持久 `compaction/*` 事件派生，且先于响应写入排队，与 `current_mode_update` 一致。未声明的连接执行完全相同的引擎调用，但收不到任何压缩更新。
- 会话有活跃工作时调用 `session/compact` 以携带 `data.code: "busy"` 的 internal error 失败，与进程内维护一致。未知会话 id 以 `Invalid params` 失败；未组合压缩引擎的组合以 internal error 失败并说明缺口。
- 引擎路径与自动压缩完全相同：持久 `compaction/start`／`compaction/summary`／`compaction/end` 事件记录桥接层铸就的 `acp-` 发起方，摘要只经会话日志进入后续轮次，因此 resume 的会话原样经由压缩后的历史重建。

## 迁移

1. 想要驱动压缩的 ACP 客户端：在 `initialize` 声明 `clientCapabilities: { session: { compaction: {} } }`，在轮次之间调用 `session/compact`，并等待配对的 `compaction_update` 后再依赖结果——通知先于响应到达线上，`completed` 更新是唯一生效事实。
2. 不关心的客户端可以整体忽略该方法；省略能力即保持连接对压缩静默，同时执行路径照常可用。
3. 把 `busy`（`data.code: "busy"`）视为会话结算后可重试：取消或等待活跃轮次结束后再次调用。
4. 确认：全新会话返回 `{ result: null }` 且无通知；两段散文轮次后调用返回非空结果，其 `summary` 至少含一个文本块；resume 的进程经由压缩后的日志继续服务轮次。

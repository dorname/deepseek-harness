## ADDED — 场景 S02：网络 ACP 权限确认回环

> 变更：20261020-1643-acp-over-network

## 目标

描述 ACP server 通过 WebSocket 双向帧向 client 发起 `session/request_permission`，client 返回决策后 server 继续执行 turn 的时序。

## 时序图

```text
Client                          dsh-acp-network                AcpBridge          UserApproval
  |                                     |                         |                    |
  |=== 已建立 WebSocket 连接 ===========|                         |                    |
  |                                     |                         |                    |
  |--- session/prompt {sessionId} ----->|                         |                    |
  |                                     |--- prompt() ------------->|                    |
  |                                     |                         |--- queue user msg   |
  |                                     |                         |--- tool call needs permission
  |                                     |                         |--- emit approval/request
  |                                     |                         |                    |
  |                                     |                         |<-- approval/request --|
  |                                     |--- drainUpdates() --------|                    |
  |                                     |--- request(methods.client.session.requestPermission)
  |                                     |                         |                    |
  |<-- session/request_permission {toolCallId, options} -------------|                    |
  |                                     |                         |                    |
  |--- session/request_permission response {outcome} -------------->|                    |
  |                                     |--- map outcome to 'allowed-once' / 'rejected' / 'cancelled'
  |                                     |--- resume waterfall      |                    |
  |                                     |                         |--- grant/reject once |
  |                                     |                         |--- continue turn     |
  |<-- session/update (tool_call, tool_call_update, ...) -----------|                    |
  |<-- session/prompt response {stopReason} ------------------------|                    |
```

## 关键设计决策

1. **双向帧天然支持 server→client 请求**：WebSocket 模式下，`session/request_permission` 作为 JSON-RPC request 从 server 发往 client，client 必须返回 response；HTTP fallback 下该场景依赖 SSE/POST 轮询，本期优先 WebSocket。
2. **桥接只提供一次性选项**：`allowed-once`、`rejected`、`cancelled`，不推断持久授权；与 dsh-subagent-acp 语义一致。
3. **更新顺序**：在发起权限请求前调用 `record.drainUpdates()`，确保 client 已收到该 turn 之前的所有 `session/update`，避免权限弹窗与未读内容交错。

## 验收标准

- UT-S02：权限请求经 WebSocket 送达测试 client，client 返回 `cancelled` 后 turn 按取消/拒绝结算。
- ST-S02：staging 中权限确认双向帧在 5s 内完成往返。

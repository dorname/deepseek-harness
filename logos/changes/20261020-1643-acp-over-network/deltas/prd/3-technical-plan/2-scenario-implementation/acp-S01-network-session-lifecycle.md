## ADDED — 场景 S01：网络 ACP 会话生命周期

> 变更：20261020-1643-acp-over-network

## 目标

描述 dspm chat relay 或自动化客户端通过 WebSocket 首次连接 dsh 网络 ACP server、创建会话、执行 prompt、断连后重连并恢复会话的完整时序。

## 时序图

```text
Client                          dsh-acp-network                AcpBridge           AgentLoop/LLM
  |                                     |                         |                    |
  |--- WS upgrade /acp ---------------->|                         |                    |
  |<-- 101 + Acp-Connection-Id ---------|                         |                    |
  |                                     |--- create AcpBridge ---->|                    |
  |--- initialize {protocolVersion} --->|                         |                    |
  |                                     |--- initialize() -------->|                    |
  |<-- initialize response --------------|                         |                    |
  |--- authenticate {token} ------------>|                         |                    |
  |                                     |--- validate token        |                    |
  |                                     |--- authenticate() -------->|                    |
  |<-- authenticate response ------------|                         |                    |
  |--- session/new {cwd, mcpServers} --->|                         |                    |
  |                                     |--- newSession() --------->|                    |
  |                                     |                         |--- create agent     |
  |                                     |                         |--- mount MCPs       |
  |                                     |                         |--- flush session    |
  |<-- session/new response {sessionId} -|                         |                    |
  |--- session/prompt {sessionId, ...} ->|                         |                    |
  |                                     |--- prompt() ------------->|                    |
  |                                     |                         |--- queue user msg   |
  |                                     |                         |--- stream chunks    |
  |<-- session/update (agent_message_chunk) ------------------------|                    |
  |<-- session/update (usage_update) -------------------------------|                    |
  |<-- session/prompt response {stopReason: end_turn} --------------|                    |
  |--- session/close {sessionId} ------->|                         |                    |
  |                                     |--- closeSession() ------->|                    |
  |                                     |                         |--- flush & dispose  |
  |<-- session/close response -----------|                         |                    |
  |=== 断连 / 重连 ======================|                         |                    |
  |--- WS upgrade /acp (new socket) ---->|                         |                    |
  |--- initialize --------------------->|                         |                    |
  |--- authenticate {new token} -------->|                         |                    |
  |--- session/resume {sessionId} ----->|                         |                    |
  |                                     |--- persistence.stat() --->|                    |
  |                                     |                         |--- load log         |
  |                                     |--- resumeSession() ------>|                    |
  |                                     |                         |--- resume agent     |
  |<-- session/resume response ----------|                         |                    |
  |--- session/prompt {sessionId, ...} ->|                         |                    |
  |<-- session/update + prompt response -|                         |                    |
```

## 关键设计决策

1. **connection 与 session 生命周期解耦**：每个 connection 由独立的 `AcpBridge` 服务，但 session 持久化到 `JsonlSessionPersistence`；client 通过 `session/close` 显式持久化并释放 agent。
2. **断连恢复依赖持久化 resume**：当前实现下，connection 关闭会触发 bridge 关闭其拥有的 session；因此未显式 `session/close` 的会话在断连后只能通过 `session/resume` 恢复已 flush 到磁盘的会话。
3. **认证前置**：`authenticate` 必须在 `initialize` 之后、`session/new` 之前完成；token 校验失败会抛出 `RequestError`，client 收到 JSON-RPC error。

## 验收标准

- UT-S01：WebSocket 完整 prompt 闭环，收到 `agent_message_chunk` 与 `usage_update`。
- ST-S01：`session/close` 后同实例可 `session/resume`，继续对话。

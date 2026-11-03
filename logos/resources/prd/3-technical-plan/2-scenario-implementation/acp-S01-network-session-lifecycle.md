# 场景 S01：网络 ACP 会话生命周期

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

## 动态模型目录衔接（S48）

S48 复用本场景的连接、认证和会话生命周期，不新增网络 ACP 方法。首次 `session/new` 与持久化 `session/resume` 在既有响应构建阶段读取模型目录并填充 `configOptions`：

1. bridge 完成 agent/session 准备后，model control 通过 `llm.listModels(provider, signal)` 获取当前动态或人工覆盖目录。
2. 成功目录按原样模型 ID 生成 choices/options；成功空目录生成空 options。已持久化但不在目录中的模型可保留 currentValue，不补入 options。
3. 任一必需目录发现失败时，`session/new`/`resume` 返回 JSON-RPC error 并执行既有会话资源回滚，不返回静态目录或伪正常空组。
4. `session/set_config_option` 重新遵守同一缓存规则构建 choices，只接受目录内值；后继 options 构建成功后才提交选择。失败不改变既有选择。
5. 已建立会话的 prompt 继续使用已提交的精确模型 ID；后台或独立目录读取失败不强制取消纯推理，后续显式目录操作仍返回真实结果或错误。

对应覆盖：UT-S48-06、UT-S48-07、ST-S48-01、ST-S48-02，并复用 ST-S03-01、ST-S03-02、ST-S26-01 验证既有会话与取消行为。

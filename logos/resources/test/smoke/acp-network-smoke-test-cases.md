# ACP-over-network Smoke 测试

> 变更：20261020-1643-acp-over-network

## SMOKE-acp-network-01：网络 ACP 端到端 prompt

### 目的

验证本地 staging 中 dsh 网络 ACP server 可通过 WebSocket 接受认证、创建会话并返回完整 prompt 结果。

### 前置条件

- 已部署或本地启动 `dsh --profile acp-network`。
- 已配置 `DSH_ACP_NETWORK_SECRET`、`DSH_FLEET_USER_ID`、`DSH_ACP_NETWORK_AUDIENCE`。
- 已签发有效期 ≤5 分钟的 HMAC token（audience 匹配，subject 匹配 `DSH_FLEET_USER_ID`）。

### 步骤

1. 测试 client 通过 `ws://HOST/acp` 发起 WebSocket upgrade。
2. 发送 `initialize { protocolVersion: 1 }`。
3. 发送 `authenticate { methodId: 'bearer', _meta: { token } }`。
4. 发送 `session/new { cwd: '/tmp', mcpServers: [] }`。
5. 发送 `session/prompt { sessionId, prompt: [{ type: 'text', text: 'hello' }] }`。
6. 收集 `session/update` 通知。
7. 发送 `session/close { sessionId }`。

### 期望结果

- `initialize` 返回 agentCapabilities 包含 resume/close/list session 能力。
- `authenticate` 返回成功。
- `session/new` 返回有效 `sessionId`。
- prompt 返回 `{ stopReason: 'end_turn' }`。
- 文本更新包含模型输出内容。

## SMOKE-acp-network-02：断连后 `session/resume` 恢复

### 目的

验证 client 在显式 `session/close` 并断开 WebSocket 后，可通过新连接 resume 同一持久化会话并继续交互。

### 前置条件

- 同 SMOKE-acp-network-01。
- 实例使用持久化存储（默认 JsonlSessionPersistence）。

### 步骤

1. 连接并认证。
2. `session/new` → `session/prompt` → `session/close`。
3. 断开 WebSocket。
4. 新 WebSocket 连接，重新 `initialize` 与 `authenticate`（新 token）。
5. `session/resume { sessionId, cwd: '/tmp', mcpServers: [] }`。
6. `session/prompt { sessionId, prompt: [{ type: 'text', text: 'continue' }] }`。

### 期望结果

- `session/resume` 返回成功。
- 新 prompt 正常返回 `{ stopReason: 'end_turn' }`。
- 模型能看到前一轮对话上下文（如适用）。

## 失败判定

以下任一情况视为 smoke 失败：

- WebSocket 连接在 5s 内无法建立。
- `authenticate` 在有效 token 下失败。
- prompt 在 60s 内未返回。
- `session/resume` 对已关闭会话失败。

## 执行方式

- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`
- Staging：通过 `deploy/acp-network/k8s/` 部署后，在 relay 侧或独立 runner 执行。

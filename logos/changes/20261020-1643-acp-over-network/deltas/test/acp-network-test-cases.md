## ADDED — ACP-over-network 测试用例

> 变更：20261020-1643-acp-over-network

## 单元测试

### UT-S01：WebSocket 完整 prompt 闭环

- **位置**：`packages/acp/acp-network/tests/network.spec.ts`
- **输入**：mock LLM adapter 返回 `"hello from network"` 文本流。
- **步骤**：
  1. `initialize`
  2. `authenticate`（有效 token）
  3. `session/new`
  4. `session/prompt`
  5. 收集 `session/update`
  6. `session/close`
- **期望**：
  - `session/new` 返回 `sessionId`。
  - prompt 返回 `stopReason === 'end_turn'`。
  - `agent_message_chunk` 更新拼接为 `"hello from network"`。

### UT-S02：认证失败

- **位置**：`packages/acp/acp-network/tests/network.spec.ts`
- **输入**：无效 token、过期 token。
- **步骤**：
  1. `initialize`
  2. `authenticate`（无效/过期 token）
- **期望**：`authenticate` 抛出错误。

### UT-S03：断连后 resume

- **位置**：`packages/acp/acp-network/tests/network.spec.ts`
- **输入**：同一 persistence root，先 `closeSession` 再重建 harness。
- **步骤**：
  1. 第一个 harness：`session/new` → `prompt` → `closeSession` → dispose。
  2. 第二个 harness（同一 persistence root）：`session/resume` → `prompt`。
- **期望**：`session/resume` 成功，prompt 返回 `stopReason === 'end_turn'`。

### UT-S04：bundle 配置声明

- **位置**：`packages/bundle/acp-network-app/tests/acp-network-app.spec.ts`
- **输入**：`cordis.patch.yml`。
- **期望**：
  - patch 声明 `acp-network-app-startup` 与 `acp-network` 行。
  - `acp-network` 注入 `acpAppStartup`，默认 transport 为 `websocket`，path 为 `/acp`。
  - `acp` 与 `session-title-llm` 被禁用。

## 集成 / Smoke 测试

### ST-S01：网络 ACP 端到端 prompt

- **触发**：本地 staging 或 CI smoke runner。
- **步骤**：
  1. 启动 `dsh --profile acp-network`。
  2. 测试 client 用有效 token 连接 `ws://HOST/acp`。
  3. 执行 `initialize` → `authenticate` → `session/new` → `session/prompt`。
- **期望**：收到文本更新与 `end_turn` 停止原因。

### ST-S02：断连后 `session/resume` 恢复

- **触发**：本地 staging 或 CI smoke runner。
- **步骤**：
  1. 建立连接，创建会话，执行 prompt，`session/close`。
  2. 断开 WebSocket。
  3. 新连接，重新 `initialize`/`authenticate`，`session/resume`。
  4. 继续 prompt。
- **期望**：`session/resume` 成功，新 prompt 正常返回。

## 追溯表

| 需求/场景 | 对应代码/测试 | 状态 |
|-----------|---------------|------|
| WebSocket 传输 | `packages/acp/acp-network/src/index.ts` | 已实现 |
| Streamable HTTP fallback | `packages/acp/acp-network/src/index.ts` | 已实现 |
| HMAC token 认证 | `packages/acp/acp-network/src/index.ts` | 已实现 |
| session/new + prompt | `packages/acp/acp-network/tests/network.spec.ts` UT-S01 | 已通过 |
| 认证失败 | `packages/acp/acp-network/tests/network.spec.ts` UT-S02 | 已通过 |
| session/resume | `packages/acp/acp-network/tests/network.spec.ts` UT-S03 | 已通过 |
| bundle 声明 | `packages/bundle/acp-network-app/tests/acp-network-app.spec.ts` UT-S04 | 已通过 |
| staging smoke prompt | ST-S01 | 待部署验证 |
| staging smoke resume | ST-S02 | 待部署验证 |

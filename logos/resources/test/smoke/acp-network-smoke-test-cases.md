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

## SMOKE-acp-network-03：会话审批策略配置与审批往返

### 目的

验证 staging 部署面上，外部客户端可经 `session/set_config_option` 配置会话审批策略，`always` 档下工具调用触发 `session/request_permission` 往返，一次性应答正确结算。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 测试 client 已实现 `session/request_permission` 应答（allow-once / reject-once）。
- 测试模型可产生至少一次工具调用（如文件写），prompt 内容不依赖真实用户数据。

### 步骤

1. 连接并认证，`session/new`。
2. `session/set_config_option { sessionId, optionId: 'permission_policy', value: 'always' }`。
3. 读取 configOptions，确认广告 `permission_policy=always` 与 `permission_preset` 预设目录。
4. 发起带工具调用的 prompt；收到 `session/request_permission` 后应答 allow-once。
5. 对同一会话第二次工具调用应答 reject-once。
6. `session/set_config_option { permission_policy: 'paranoid' }` 验证错误分支。
7. `session/close` → 新连接认证后 `session/resume`，读取 configOptions。

### 期望结果

- 第 2 步设置成功，第 3 步 configOptions 回显 `always` 与预设目录。
- 第 4 步工具调用前收到 `session/request_permission`（含两个一次性选项），allow-once 后工具执行。
- 第 5 步 reject-once 后该调用被拒、会话与回合继续。
- 第 6 步返回 invalid params 类错误，策略保持 `always`。
- 第 7 步 resume 后 configOptions 仍回显 `always`。
- 全程既有 prompt/resume 行为不受影响。

## SMOKE-acp-network-04：会话技能清单枚举

### 目的

验证 staging 部署面上，外部客户端可经 `session/skills_list` 枚举会话可见技能清单及双调用旗标，未知会话错误分支生效，且既有通道与会话行为不受影响。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `dsh-base`（默认即挂载 `@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-skill-filesystem`）。

### 步骤

1. 连接并认证，`session/new`。
2. `session/skills_list { sessionId }`。
3. 对部署环境已知技能目录（用户级根目录）核对清单一致性。
4. `session/skills_list { sessionId: 'unknown-id' }` 验证错误分支。
5. 正常 prompt 往返一次，随后再次 `session/skills_list`。

### 期望结果

- 第 2 步返回 `{ skills: [...] }` 数组，按名字典序排列，每项恰含 `name`、`description`、`modelInvocable`、`userInvocable`；与已知技能目录一致（部署环境无技能时合法返回空数组）。
- 第 4 步返回 invalid params 类错误。
- 第 5 步 prompt 正常结算，再次枚举与第 2 步一致；既有 prompt/resume 行为不受影响。

## 失败判定

以下任一情况视为 smoke 失败：

- WebSocket 连接在 5s 内无法建立。
- `authenticate` 在有效 token 下失败。
- prompt 在 60s 内未返回。
- `session/resume` 对已关闭会话失败。
- SMOKE-acp-network-03 中：`always` 会话的工具调用未触发 `session/request_permission`，或 allow-once 后工具未执行、reject-once 后会话中断。
- SMOKE-acp-network-03 中：未知策略值未返回错误、resume 后策略未恢复，或未配置策略的既有会话出现计划外询问。
- SMOKE-acp-network-04 中：`skills_list` 响应结构不合法（非数组、缺字段、乱序），已知技能缺席，或未知会话未返回错误。

## 执行方式

- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返与 SMOKE-acp-network-04 技能清单枚举；无 answerer 的 fail-closed 分支在单元层覆盖，不在本地 smoke 重复）。
- Staging：通过 `deploy/acp-network/k8s/` 部署后，在 relay 侧或独立 runner 执行（含 SMOKE-acp-network-03）。

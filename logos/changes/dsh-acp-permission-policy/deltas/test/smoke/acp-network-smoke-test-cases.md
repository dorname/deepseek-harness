# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-permission-policy）

## ADDED — SMOKE-acp-network-03：会话审批策略配置与审批往返

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

## MODIFIED — 失败判定

以下任一情况视为 smoke 失败：

- WebSocket 连接在 5s 内无法建立。
- `authenticate` 在有效 token 下失败。
- prompt 在 60s 内未返回。
- `session/resume` 对已关闭会话失败。
- SMOKE-acp-network-03 中：`always` 会话的工具调用未触发 `session/request_permission`，或 allow-once 后工具未执行、reject-once 后会话中断。
- SMOKE-acp-network-03 中：未知策略值未返回错误、resume 后策略未恢复，或未配置策略的既有会话出现计划外询问。

## MODIFIED — 执行方式

- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返；无 answerer 的 fail-closed 分支在单元层覆盖，不在本地 smoke 重复）。
- Staging：通过 `deploy/acp-network/k8s/` 部署后，在 relay 侧或独立 runner 执行（含 SMOKE-acp-network-03）。

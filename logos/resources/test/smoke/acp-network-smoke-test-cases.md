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

## SMOKE-acp-network-05：会话计划模式面

### 目的

验证 staging 部署面上，外部客户端可经标准方法 `session/set_mode` 感知与切换 dsh 计划模式，`modes` 广告与 `current_mode_update` 时序符合规格，错误分支生效，且既有通道与会话行为不受影响。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `dsh-base`（默认即挂载 `@deepseek-ai/dsh-plan-mode`）。

### 步骤

1. 连接并认证，`session/new`，读取响应 `modes`。
2. `session/set_mode { modeId: 'plan' }`，观察 `session/update` 的 `current_mode_update`。
3. `session/resume`（断连重连），读取响应 `modes`。
4. `session/set_mode { modeId: 'normal' }`，观察更新；随后重复设置 `normal` 一次。
5. `session/set_mode { modeId: 'plan' }` + `session/set_mode { modeId: 'other' }` 验证词表错误分支。
6. 正常 prompt 往返一次。

### 期望结果

- 第 1 步 `modes.availableModes` 恰为 plan / normal 二值（含 name），`currentModeId` 为 `normal`。
- 第 2 步响应立即返回且恰伴随一次 `current_mode_update(plan)`。
- 第 3 步 resume 后 `currentModeId` 为 `plan`。
- 第 4 步切回 normal 紧随一次更新；重复设置无新更新。
- 第 5 步 plan 正常提交；`other` 返回 invalid params 类错误且消息含 plan/normal 词表。
- 第 6 步 prompt 正常结算；SMOKE-acp-network-01..04 既有行为不受影响。

## SMOKE-acp-network-06：会话压缩面

### 目的

验证 staging 部署面上，外部客户端可经 `session/compact` 触发原生压缩并取得结构化结果，busy 竞态与错误分支生效，能力门控通知正确隔离，且既有通道与会话行为不受影响。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `dsh-base`（默认即挂载 `@deepseek-ai/dsh-compaction-basic`）与可用真实模型（压缩执行需要真实历史）。

### 步骤

1. 连接并认证（声明 `clientCapabilities.session.compaction`），`session/new`。
2. 真实模型 prompt 数轮产生可压缩历史。
3. `session/compact { sessionId }`，观察响应与 `compaction_update` 通知序列。
4. 压缩进行中并发第二次 `session/compact`（竞态窗口内）。
5. `session/resume` 后检查历史已替换；新开无历史会话调用 `session/compact`。
6. `session/compact { sessionId: 'unknown-id' }` 验证错误分支。
7. 另建一条未声明 compaction 能力的连接执行同样压缩，观察通知。
8. 正常 prompt 往返一次。

### 期望结果

- 第 3 步响应含 compactionId / summarySeq / shadowedCount / shadowedTokenCount / summary；通知按 in_progress → completed（含摘要块）到达。
- 第 4 步竞态调用返回 `data.code: 'busy'`（竞态窗口未命中时如实记录，不得伪报）。
- 第 5 步 resume 后表面已被摘要替换；无历史会话合法返回 `{ result: null }`。
- 第 6 步返回 invalid params 类错误。
- 第 7 步未声明能力的连接全程零 `compaction_update`。
- 第 8 步 prompt 正常结算；SMOKE-acp-network-01..05 既有行为不受影响。

## SMOKE-acp-network-07：多供应商路由供给与切换面

### 目的

验证部署组合以数组形式供给多供应商路由时，网络 ACP 面的分组广告、跨供应商切换与 resume 持久生效，形态冲突在加载期指名失败。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `llm-pi-ai` 且其 `providerList` 键供给两个本地 mock 供应商路由（mock HTTP 后端，apiKeyEnv 指向本地凭据）。staging 默认组合无 providerList 供给时按 skip 语义记录，永不报 PASS。

### 步骤

1. 以数组组合启动实例，WebSocket 连接并认证，`session/new`。
2. 核对响应 configOptions：模型选项按两个供应商分组呈现，默认路由为 provider/model 值对所指路由。
3. `set_config_option` 切换到另一供应商的模型，prompt 往返一次。
4. 断开重连，`session/resume`，核对模型选择保持。
5. 以冲突组合（`providers` 与 `providerList` 同供）独立启动第二实例，观察加载失败。
6. 正常 prompt 往返一次（默认路由）。

### 期望结果

- 第 2 步 configOptions 两供应商分组齐全，选项值编码与既有 modelValue 一致。
- 第 3 步切换生效，mock 后端收到被切换路由的请求。
- 第 4 步 resume 后选择保持（经 EpochHeader 恢复）。
- 第 5 步加载失败诊断指名两键同供冲突来源。
- 第 6 步正常结算；SMOKE-acp-network-01..06 既有行为不受影响。

## 失败判定

以下任一情况视为 smoke 失败：

- WebSocket 连接在 5s 内无法建立。
- `authenticate` 在有效 token 下失败。
- prompt 在 60s 内未返回。
- `session/resume` 对已关闭会话失败。
- SMOKE-acp-network-03 中：`always` 会话的工具调用未触发 `session/request_permission`，或 allow-once 后工具未执行、reject-once 后会话中断。
- SMOKE-acp-network-03 中：未知策略值未返回错误、resume 后策略未恢复，或未配置策略的既有会话出现计划外询问。
- SMOKE-acp-network-04 中：`skills_list` 响应结构不合法（非数组、缺字段、乱序），已知技能缺席，或未知会话未返回错误。
- SMOKE-acp-network-05 中：`modes` 广告缺失或词表不合法，`set_mode` 后无 `current_mode_update` 或出现冗余更新，resume 后模式未恢复，或未知 modeId 未返回含词表的 invalid params 类错误。
- SMOKE-acp-network-06 中：压缩响应结构不合法（缺字段、类型错误），`{ result: null }` 被报为错误，竞态 busy 分支未生效（窗口命中时），未声明能力的连接收到 `compaction_update`，或已知历史压缩后 resume 未替换。
- SMOKE-acp-network-07 中：configOptions 分组缺失或错组、切换未命中被选路由、resume 后选择丢失，或冲突组合未在加载期指名失败。

## 执行方式

- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返、SMOKE-acp-network-04 技能清单枚举、SMOKE-acp-network-05 计划模式面、SMOKE-acp-network-06 压缩面与 SMOKE-acp-network-07 多供应商路由供给面；06 压缩执行需真实模型产历史、07 需本地数组组合与 mock HTTP 供应商后端，无对应条件的环境按既有 skip 语义如实跳过）。
- Staging：通过 `deploy/acp-network/k8s/` 部署后，在 relay 侧或独立 runner 执行（含 SMOKE-acp-network-03）。

# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-goal-approval）

## ADDED — SMOKE-acp-network-08：goal 授权卡往返面

在 SMOKE-acp-network-07 之后追加：

```markdown
## SMOKE-acp-network-08：goal 授权卡往返面

### 目的

验证 ACP 会话内未授权 goal 完成/受阻调用经 `session/request_permission` 征求人类应答，Authorize 回传后在同回合内完成提交、会话日志含 witnessed 用户消息，Deny 保持既有拒绝。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 会话组合含 base bundle 的 goal 工具与 userQuestions 通道（默认组合即满足）；mock LLM 后端驱动一次未授权 `complete` 工具调用。staging 无交互握手时按既有 skip 语义记录，永不报 PASS。

### 步骤

1. `session/new` → prompt 驱动模型创建 goal 并在无 direct-human 输入的回合内调用 `complete`。
2. 客户端收到 `session/request_permission`，核对选项词汇（Authorize / Deny）与问题指名 goal。
3. 应答 Authorize → 等待模型重调 → 核对完成结果与会话日志：注入的源 user `user/message`、`user-question-reply`、goal 完成事件齐备。
4. 第二会话重复步骤 1–2 并应答 Deny → 核对工具结果注明拒绝、无注入消息、goal 状态不变。

### 期望

- 步骤 2：`request_permission` 选项为 Authorize/Deny 两项，问题指名 goal 标题与操作。
- 步骤 3：完成提交；日志同时含 witnessed 用户消息与完成事件（模型可见 ⟺ 已记录）。
- 步骤 4：既有权威拒绝保持，goal 不变；SMOKE-acp-network-01..07 既有通道不受影响。
```

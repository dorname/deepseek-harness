# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-goal-approval）

## ADDED — SMOKE-acp-network-08：goal 授权卡往返面

在 SMOKE-acp-network-07 之后追加：

```markdown
## SMOKE-acp-network-08：goal 授权卡往返面

### 目的

验证 ACP 会话内未授权 goal 完成调用经 `session/request_permission` 征求人类应答：Deny 保持既有拒绝（goal 不变、无第二次征求），Authorize 回传经注入的 witnessed 用户消息使模型重调通过权威门槛并完成提交。征求卡是 wire 面呈现，不入会话日志；日志断言由 ST-S54-01 与快照场景承载。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 会话组合含 base bundle 的 goal 工具与 userQuestions 通道（默认组合即满足）；本地组合另含 `smoke_goal_wake` wake fixture 工具（非人类续延源，不经 user 通道伪造见证权威），mock LLM 后端按请求历史中的真实 goal ref 动态解析两次未授权 `complete` 调用参数。staging 无交互握手时按既有 skip 语义记录，永不报 PASS。

### 步骤

1. `session/new` → prompt 驱动模型创建 goal 并调用 wake，打开无 direct-human 输入的续延回合调用 `complete`。
2. 第一次 `session/request_permission`：核对选项词汇（approve/deny · allow_once/reject_once · Authorize/Deny）与随行 toolCall 指名本次完成调用 → 应答 Deny。
3. Deny 后模型在同一续延回合内继续（再次 wake 并收束该回合）→ 第二次续延回合再次调用 `complete` → 第二次 `session/request_permission` 核对同一词汇与随行 toolCall → 应答 Authorize。
4. 等待模型重调 → 核对 goal 完成提交（服务端 goal phase `complete`）、完成调用 `tool_call` 卡在案、最终文本收束。

### 期望

- 步骤 2/3：两次 `request_permission` 各含 Authorize/Deny 两项（allow_once/reject_once），随行 toolCall 分别指名两次完成调用。
- 步骤 4：完成提交；witnessed 用户消息与完成事件的日志断言由 ST-S54-01 与快照场景承载（模型可见 ⟺ 已记录）。
- Deny 分支的拒绝文本与无注入断言由 ST-S54-01 承载；SMOKE-acp-network-01..07 既有通道不受影响。
```

## MODIFIED — 执行方式与失败判据（追加 08 条目）

```markdown
（含 SMOKE-acp-network-03 审批策略往返、SMOKE-acp-network-04 技能清单枚举、SMOKE-acp-network-05 计划模式面、SMOKE-acp-network-06 压缩面、SMOKE-acp-network-07 多供应商路由供给面与 SMOKE-acp-network-08 goal 授权卡往返面；06 压缩执行需真实模型产历史、07 需本地数组组合与 mock HTTP 供应商后端、08 需本地 goal 组合与交互握手，无对应条件的环境按既有 skip 语义如实跳过）。
```

```markdown
- SMOKE-acp-network-08 中：征求选项词汇不合法（缺项、错 kind、错标签），随行 toolCall 未指名完成调用，Deny 后出现第二次征求或 goal 提前提交，或 Authorize 后 goal 未完成。
```

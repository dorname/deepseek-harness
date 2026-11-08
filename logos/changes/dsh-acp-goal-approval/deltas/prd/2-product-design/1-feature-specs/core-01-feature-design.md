# delta — core-01-feature-design.md（变更 dsh-acp-goal-approval）

## ADDED — §14 goal 完成授权经 ACP 规格（S54）

在 §13 之后追加（文件末尾）：

```markdown
## 14. goal 完成授权经 ACP 规格（S54）

### 14.1 授权征求路径

- `tool-goal` 的 `complete`/`blocked` 在 `completionAuthority`（`packages/goal/tool-goal/src/authority.ts:111-118`）拒绝时，先查 `ctx.get('userQuestions')`：缺失则维持既有立即 `GOAL_TOOL_AUTHORITY_REQUIRED`（消息与错误码不变）；存在则发起 `interaction.ask()`——单问题，header「Goal review」，问题指名 goal 标题、id 与操作（完成/受阻），选项 `Authorize`（批准该操作）与 `Deny`（拒绝），intent `{kind: 'goal-review', approve: 'Authorize', goalId, callId?}`。
- 权威门槛先于征求：admitted round（`isMatchingGoalRound`）与开放回合内已有 direct-human（`hasDirectHumanInput`）的调用在门槛即通过，不进入 ask 路径。
- ask 携带 `agent` 与 `signal: exec.signal`（回合取消即取消征求）；`ASK_CANCELLED`（人类收起卡片改发言）映射为与 plan-mode 同构的友好工具失败文本，不产生任何注入。

### 14.2 授权回传（witnessed steer-back）

- Authorize 应答后，工具调用 `agent.steer()` 注入一条 `UserMessage`（省略 source → 解析为 `user`，`agent.ts:167-169`；'next-step' 目标）——消息在工具结果提交之后、同开放回合内落一条 `user/message` 事件（`source.kind='user'`），模型下一步可见。文本固定为「确认人类已授权该 goal 的该操作，并指示立即重调完成工具」（措辞实现期定稿，经快照固定）。
- 工具返回结构化结果指明人类已授权、指示重调；模型重调时 `completionAuthority` 以 direct-human 通过，完成照常提交。授权流全程无外部 `GoalService` 调用——`GoalService.complete`（`goal/src/index.ts:390-400`）与 `authority.ts` 零改动，「任何客户端调用都无法授予」安全模型保持。
- Deny 应答：不注入、不产生见证输入；工具返回注明「人类已拒绝授权」的既有权威拒绝（错误码不变），模型继续既有行为。

### 14.3 ACP 承载与意图联合

- bridge 在既有 `user-questions/request` 瀑布（`bridge.ts:532-537`）新增 goal-review 应答者，与 `answerPlanReview` 同构：仅截获 owned session + 单问题 + `goal-review` 意图 + callId 匹配的请求，经 `session/request_permission` 呈现 Authorize/Deny 选项词汇（`planReviewPermissionOptions` 同构 helper），映射 outcome 回 ask 应答；其余意图与无主会话 `next()` 透传，行为不变。
- `AskUserQuestionIntent` 新增 `goal-review` tagged kind：呈现意图扩展，协议与应答编码不变；不识别该 kind 的 UI 渲染通用选项卡（联合既有开放契约，`types.ts:18-33`）。intent 为宿主内类型——bridge 出线前已转换为 `session/request_permission` 选项，不跨 ACP wire，双 SDK 零改动。
- 协议方法零新增（复用 `session/request_permission`）；零新增会话事件类型（ask 循环既有 `user-question-reply`，注入消息即普通 `user/message`）；零新增 Config；`SessionEventMap` 与 Session format 4 不变。模型可见 ⟺ 已记录不变量保持：注入的授权消息与会话内既有事件可完整重建。

### 14.4 安全论证

- 授予的唯一形态仍是「根 agent 开放回合内、宿端见证的 `source.kind='user'` 消息」；ACP 应答只是把经认证连接上的人类动作转换为该形态的工件——转换发生在 goal 工具内（持有活 agent 句柄），不新增任何可从外部触达完成语义的入口。
- Deny、取消、超时（无超时配置——信号即回合取消）、无应答者均收敛到既有权威拒绝；不存在「部分授权」状态。
- web 宿主经既有通用卡片流应答同一请求——goal 授权在 web 面同变更内生效，无宿主代码改动。
```

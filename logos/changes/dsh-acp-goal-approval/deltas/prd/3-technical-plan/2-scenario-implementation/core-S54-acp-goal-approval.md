# core S54（goal 完成授权经 ACP 客户端应答）— 场景实现

> 来源：变更 `dsh-acp-goal-approval`。场景来源 `core-01-requirements.md` §S54；功能规格见 `core-01-feature-design.md` §14。

## 授权时序（ACP 会话，未授权完成调用）

```
模型(回合 N 进行中)        tool-goal            userQuestions         ACP bridge            ACP 客户端
  | complete_goal(ref) ---> |                     |                    |                     |
  |                    completionAuthority 拒绝                 |                     |
  |                         | ctx.get('userQuestions') 存在            |                     |
  |                         |-- ask(goal-review 意图, Authorize/Deny) ->|                     |
  |                         |                     |-- user-questions/request ->|            |
  |                         |                     |                    |-- request_permission ->|
  |                         |                     |                    |<-- outcome(Authorize) --|
  |                         |<------------ 应答(Authorize) --------------|                     |
  |                         | agent.steer(授权用户消息, source→user)    |                     |
  |<-- 结果:人类已授权,重调 --|                     |                    |                     |
  | (下一步: user/message 落回合, 模型可见)               |                    |                     |
  | complete_goal(ref) ---> |                     |                    |                     |
  |                    completionAuthority: direct-human ✓  |                     |
  |<-- 完成提交 ------------- | goals.complete() 照常                     |                     |
```

- 注入消息在工具结果之后、同开放回合内提交（steer 目标 'next-step'）；`completionAuthority` 重调时扫描 `openTurnStartSeq+1..`（`authority.ts:64-73`）命中该 `user/message`。
- Deny / `ASK_CANCELLED`：无注入，工具返回注明拒绝的既有权威拒绝，回合继续。

## 路径矩阵

| 前置状态 | 行为 | 会话日志 |
|----------|------|----------|
| admitted round / 已有 direct-human | 权威门槛通过，不征求 | 与既往一致 |
| 无授权 + 有通道 + Authorize | 征求卡经 `session/request_permission`（wire 面，不入会话日志）→ steer 回传 → 重调完成 | `user/message`（steer，源 user）+ 既有工具/完成事件；无 `user-question-reply`（该事件仅存在于服务 answer() 路径，如 Web） |
| 无授权 + 有通道 + Deny / 取消 | 征求卡经 `session/request_permission`（wire 面）→ 既有权威拒绝（注明拒绝）或发言回传文本 | 无注入消息；拒绝与取消文本见既有 `tool/result` 错误 |
| 无授权 + 无通道（headless 等） | 立即 `GOAL_TOOL_AUTHORITY_REQUIRED`（行为不变） | 与既往一致 |

## 组件与契约

- `tool-goal`：ask 问题固定指名 goal 标题、id 与操作；intent `{kind:'goal-review', approve:'Authorize', goalId, callId?}`；ask 携带 `agent` 与 `signal: exec.signal`；Authorize 后 steer 文本固定（快照钉住），返回结构化结果指向重调。插件新增 optional `userQuestions` 依赖（`ctx.get`，缺失即既有行为）。
- `user-questions`：`AskUserQuestionIntent` 新增 `goal-review` tagged kind（`approve` 命名选项标签的既有校验适用）；协议与应答编码不变。
- `acp` bridge：goal-review 应答者仅截获 owned session + 单问题 + 指名意图 + callId 匹配；`session/request_permission` 选项词汇 Authorize/Deny（helper 与 `planReviewPermissionOptions` 同构）；其余意图与无主会话 `next()` 透传。
- `GoalService` / `authority.ts`：零改动。无 id seam 需求；「任何客户端调用都无法授予」保持。

## 边界

- 无超时配置：征求以 `exec.signal` 为界（回合取消即取消），与 plan-mode review 同形。
- 注入消息是普通 `user/message`：旧构建回读无损；旧构建上未授权调用为立即拒绝（无 ask），回滚行为干净。
- 快照：新增 keyless 场景 `snapshots/acp/goal-authorization/`（authored + replay.override，经 request_permission FIFO 应答）固定 steer 消息、`authorization` 工具结果与 wire 卡词汇；`snapshots/web/goal-multi-turn-actions/` 既有场景不动（其路径不触发未授权调用）。
- intent 为宿主内类型（不跨 ACP wire：bridge 出线前已转换为 request_permission 选项）：双 SDK 零改动。

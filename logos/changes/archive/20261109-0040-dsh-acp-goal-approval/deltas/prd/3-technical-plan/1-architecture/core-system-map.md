# delta — core-system-map.md（变更 dsh-acp-goal-approval）

## ADDED — §19 goal 授权面（S54）

在 §18 之后追加（文件末尾）：

```markdown
## 19. goal 授权面（S54）

goal 完成/受阻的授权征求与回传涉及四个组件，授权语义仍集中在 tool-goal 一处：

| 组件 | 职责 | 关键锚点 |
|------|------|----------|
| `tool-goal`（goal 工具） | 权威门槛拒绝且存在 userQuestions 通道时发起征求（`goal-review` 意图）；Authorize 后 `agent.steer()` 注入源为 user 的授权消息（'next-step'、同开放回合）并返回指向重调的结果；Deny/取消收敛到既有权威拒绝 | `authority.ts:111-118`（门槛）、工具实现（ask 路径新增） |
| `user-questions`（征求服务） | 承载 ask 循环与 `goal-review` tagged intent（呈现意图，协议与应答编码不变） | `types.ts:18-33`（intent 联合扩展）、`index.ts:287`（ask） |
| `acp`（bridge） | `user-questions/request` 瀑布上的第二意图应答者：owned session + `goal-review` 意图 → `session/request_permission`（Authorize/Deny 选项词汇）→ outcome 映射；其余意图 `next()` 透传 | `bridge.ts:512-537`（sendPermission 与瀑布注册模板；同构本体 `plan-mode.ts:143`） |
| `goal`（GoalService） | 零改动：完成提交仍由模型工具调用驱动，无 id seam 需求 | `goal/src/index.ts:390-400` |

安全模型不变量：授予的唯一形态是根 agent 开放回合内宿端见证的 `source.kind='user'` 消息（`authority.ts:80-84`）；ACP 应答在 goal 工具内转换为该形态，不新增外部完成入口。零新增会话事件类型与协议方法；Session format 维持 4。
```

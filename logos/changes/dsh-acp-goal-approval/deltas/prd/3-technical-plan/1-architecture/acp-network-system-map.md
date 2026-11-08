# delta — acp-network-system-map.md（变更 dsh-acp-goal-approval）

## MODIFIED — 意图应答清单（补记 goal-review）

在 plan-review 意图应答的说明之后追加：

```markdown
goal 完成授权（S54）：bridge 为 owned session 截获 `goal-review` 意图的 userQuestions 请求，经既有 `session/request_permission` 呈现 Authorize/Deny 选项词汇并映射应答（与 plan-review 同构的第二意图应答者）。协议方法零新增；客户端视角是一次普通权限卡片（选项标签指名语义）。Authorize 的回传不经协议面——goal 工具在宿端把应答转换为 witnessed 用户消息后由模型重调完成工具，外部调用仍无法授予完成。
```

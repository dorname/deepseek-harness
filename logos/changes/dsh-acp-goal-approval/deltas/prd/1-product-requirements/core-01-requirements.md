# delta — core-01-requirements.md（变更 dsh-acp-goal-approval）

## MODIFIED — 三、场景总览（表格追加一行）

在场景总览表 S53 行后追加：

```markdown
| S54 | goal 完成授权经 ACP 客户端应答 | 模型回合内未经授权的 goal 完成/受阻调用经 ACP 授权卡片征求人类应答，回传后模型在同回合完成 | P01/P08 | P1 |
```

## ADDED — 四、核心场景详述：S54

在 §四 S53 小节之后、"## 五、约束与边界" 之前插入：

```markdown
### S54: goal 完成授权经 ACP 客户端应答

- **触发条件**：模型在开放回合内调用 goal 完成/受阻工具而缺少授权（无 direct-human 见证输入、亦非该 goal 的 admitted round）；会话存在 userQuestions 通道（web 宿主卡片流或 ACP 桥接的 `session/request_permission`）——工具向人类征求授权，人类在 ACP 客户端（或 web 卡片）应答。
- **用户价值**：goal 完成授权不再要求回合结束后的额外 prompt 往返；经 ACP 驱动 dsh 会话的集成方（dspm）在回合内即可应答授权卡片，安全模型（只有人类动作可授予完成）一字未改（← P01/P08）。
- **优先级**：P1
- **主路径**：工具在权威门槛拒绝前先经 `userQuestions.ask()` 征求（问题指名 goal 标题与操作、Authorize/Deny 选项、`goal-review` 呈现意图）→ ACP 桥接以 `session/request_permission` 呈现选项词汇并映射应答（web 宿主走既有通用卡片流）→ Authorize 后工具注入一条源为 user 的授权用户消息进入同开放回合（模型可见）并返回指向重调的结果 → 模型重调完成工具经 direct-human 见证通过，完成照常提交。Deny/取消不产生注入与见证输入，工具返回注明拒绝的既有权威拒绝。
- **边界**：无 userQuestions 通道的组合（headless 等）行为不变——立即 `GOAL_TOOL_AUTHORITY_REQUIRED`；admitted round 与已有 direct-human 的调用在权威门槛即通过，永不征求；授权回传不是任何外部 complete 调用——`GoalService` 零改动、无 id seam 需求，见证条件（根 agent + 开放回合内 `source.kind='user'`）零改动；零新增会话事件类型（ask 应答循既有 `user-question-reply`，注入消息即普通 `user/message`）、零新增协议方法、零新增 Config，Session format 不变；`AskUserQuestionIntent` 新增 `goal-review` tagged kind 属呈现意图扩展，协议与应答编码不变，未知意图的 UI 走通用卡片（联合既有契约）。
```

## ADDED — 四、S54 验收条件

接在 S54 边界段之后：

```markdown
#### 验收条件
##### S54-AC-01 正常：ACP 会话内授权往返
- **GIVEN** ACP 会话内模型调用未授权的 goal 完成工具，且桥接已连接
- **WHEN** 客户端收到携带 goal 选项词汇的 `session/request_permission` 并应答 Authorize
- **THEN** 开放回合内注入一条源为 user 的授权用户消息（模型可见、入会话日志），工具返回指向重调的结果；模型重调后完成提交，会话日志同时含该用户消息与完成事件
##### S54-AC-02 异常：拒绝与取消保持既有拒绝
- **GIVEN** 同一征求，人类应答 Deny 或收起卡片改发言（ASK_CANCELLED）
- **WHEN** 工具处理应答
- **THEN** 无注入消息、无见证输入；工具返回注明人类已拒绝的既有权威拒绝；goal 状态不变
##### S54-AC-03 边界：无通道与已授权路径不征求
- **GIVEN** 无 userQuestions 通道的组合；或调用处于 admitted round / 回合内已有 direct-human 输入
- **WHEN** 调用完成/受阻工具
- **THEN** 无通道时立即 `GOAL_TOOL_AUTHORITY_REQUIRED`（行为与既往一致）；已授权路径在权威门槛通过，永不出现征求卡片
##### S54-AC-04 回归：既有授权与审批面不变
- **GIVEN** 既有 goal round 流、S49 审批策略、S51 计划模式 review 与 S03 ACP 主链路
- **WHEN** 执行既有回归与 SMOKE-acp-network-01..07
- **THEN** plan-review 意图应答与其余意图的无应答者行为不变；见证模型、SessionEventMap、Session format 不变
```

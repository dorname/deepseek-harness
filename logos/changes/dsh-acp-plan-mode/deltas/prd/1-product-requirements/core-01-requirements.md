# delta — core-01-requirements.md（变更 dsh-acp-plan-mode）

## MODIFIED — 三、场景总览（表格追加一行）

在场景总览表 S50 行后追加：

```markdown
| S51 | 外部客户端经 ACP 感知与切换计划模式 | 外部 ACP 客户端读取/设置会话模式并承接计划评审 | P01/P08 | P1 |
```

## ADDED — 四、核心场景详述：S51

在 §四 S50 小节之后、"## 五、约束与边界" 之前插入：

```markdown
### S51: 外部客户端经 ACP 感知与切换计划模式

- **触发条件**：外部 ACP 客户端（如 dspm）在 `session/new` / `session/resume` 响应中读取 `modes`（plan / normal 二值与当前模式），调用标准方法 `session/set_mode` 切换模式，经 `session/update` 的 `current_mode_update` 感知生效；模型调用 `exit_plan_mode` 时，计划评审经 `session/request_permission` 到达客户端。
- **用户价值**：dspm 以原生 ACP 会话模式面替代 prompt 约定模拟，模式状态与会话日志同源（resume 恢复）、跨客户端一致；计划评审在 ACP 下从必然失败（无应答者）变为完整闭环（← P01/P08）。
- **优先级**：P1
- **主路径**：客户端从 new/resume 响应 `modes` 读当前模式 → `session/set_mode { sessionId, modeId: 'plan' | 'normal' }` → 响应 `{}` 立即返回 → 模式提交（回合间立即、回合中排队至下一个 accepted pre-step）→ `session/update` 发 `current_mode_update`。模型在计划模式内调用 `exit_plan_mode` 提交计划 → bridge 将 plan-review 问题转换为 `session/request_permission`（`approve` / `keep-planning` 两选项）→ 客户端应答映射回评审结果 → 批准则退出计划模式、保留规划则反馈回模型。
- **边界**：`set_mode` 响应不承诺生效，`current_mode_update` 是唯一生效事实；排队中未提交的意图不跨 runtime 生存（resume 广告已提交状态）；未知 modeId 返回 invalid params 并给出词表；plan-mode 插件未组装的自定义 profile 省略 `modes`、`set_mode` 返回 internal error（fail-loud）；强制只读不在范围（plan mode 不读 sandbox/审批状态，mode→preset 联动为条件性后续，需求方提出时另立项）；`/plan` 命令、web 自有 UI 通道与 `exit_plan_mode` 工具目录不变；plan-review 之外的问题（如 `ask_user_question`）仍无 ACP 应答者（REQ-D6 范围）。
```

## ADDED — 四、S51 验收条件

接在 S51 边界段之后：

```markdown
#### 验收条件
##### 正常：modes 广告与 resume 恢复
- **GIVEN** 客户端创建新会话，随后切换模式并断连重连（resume）
- **WHEN** 检查 new 与 resume 响应的 `modes` 字段
- **THEN** `availableModes` 恒为 plan / normal 二值；`currentModeId` 为会话已提交模式（新会话 normal、切换并提交后 resume 读到 plan）
##### 正常：set_mode 提交与 current_mode_update
- **GIVEN** 会话处于空闲（无开放回合）
- **WHEN** 客户端调用 `session/set_mode` 切换 plan / normal
- **THEN** 响应立即返回 `{}`，紧随一次 `current_mode_update`（由持久 `plan/mode` 事件派生）；重复设置当前模式（noop）与清除反向排队（cancelled）不产生更新
##### 正常：回合中切换为排队生效
- **GIVEN** 会话有开放回合（prompt 进行中）
- **WHEN** 客户端调用 `session/set_mode`
- **THEN** 响应立即返回且模式未变；更新在下一个 accepted in-turn pre-step 提交时到达，时序以 `current_mode_update` 为准
##### 正常：计划评审经 request_permission 闭环
- **GIVEN** 会话处于计划模式，模型调用 `exit_plan_mode` 提交计划
- **WHEN** bridge 将 plan-review 转换为 `session/request_permission`（approve / keep-planning）且客户端分别应答 approve、keep-planning、取消
- **THEN** approve 退出计划模式且工具结果确认；keep-planning 使模型收到继续规划的反馈且模式不变；取消命中「用户收回回合」分支且会话继续；评审卡片在工具调用卡片之后到达
##### 异常：未知会话、未知模式与插件缺席 fail-loud
- **GIVEN** 客户端对未知会话 id 或未知 modeId 调用，或部署未组装 plan-mode 插件
- **WHEN** `session/set_mode`
- **THEN** 未知会话返回 invalid params 类错误；未知 modeId 返回 invalid params 类错误并给出 plan/normal 词表；插件缺席返回 internal error 类错误并说明缺装配，且 new/resume 响应不携带 `modes`
##### 回归：既有通道与会话行为
- **GIVEN** S03、S11、S49、S50 既有会话与 dsh 自有 UI 计划模式通道
- **WHEN** 执行 ACP 主链路、`/plan` 命令、审批策略、技能枚举回归
- **THEN** 既有行为保持；`/plan` 命令与 web 投影不变；`exit_plan_mode` 工具目录稳定；既有 ACP 方法请求/响应结构不变（`modes` 为新增可选字段）
```

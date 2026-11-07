# delta — core-01-feature-design.md（变更 dsh-acp-plan-mode）

## ADDED — §11、计划模式交互规格（S51）

在 §10（会话技能清单交互规格）之后追加：

```markdown
## 11. 计划模式交互规格（S51）

### S51: 外部客户端经 ACP 感知与切换计划模式 — 标准方法与字段规格

**模式词表与广告**：dsh 会话模式为二值——`plan`（计划模式）与 `normal`（默认模式）。`session/new` 与 `session/resume` 响应新增可选字段 `modes: { currentModeId, availableModes }`：`availableModes` 恒为 `[{ id: 'plan', name: 'Plan', description: '…' }, { id: 'normal', name: 'Normal', description: '…' }]`，`currentModeId` 取会话已提交（日志折叠）状态，排队中未提交的意图不体现、不跨 runtime 生存。plan-mode 插件未组装的自定义 profile 省略该字段（ACP 语义：字段缺席即不支持）；字段在场即广告，无独立 capability 位。

**切换方法**：标准方法 `session/set_mode`，请求 `{ sessionId, modeId }`、响应 `{}`。bridge 校验会话归属（未知会话 invalid params）与 modeId 词表（未知值 invalid params 并给出 plan/normal 词表）后经 `PlanModeController.set(agent, modeId === 'plan')` 落地，复用其四态结果：`committed`（回合间立即提交）/ `queued`（回合中排队至下一个 accepted in-turn pre-step）/ `cancelled`（清除反向排队）/ `noop`。响应体恒为 `{}`、不携带生效信息——**`current_mode_update` 是唯一生效事实**（dspm UI 不得依据响应假设模式已变）。plan-mode 插件缺席时 fail-loud（internal error 类，说明缺装配）。

**生效推送**：`plan/mode` 持久事件提交时，`AcpSession.onSessionEvent` 经既有 `session/update` 通道发 `{ sessionUpdate: 'current_mode_update', currentModeId }`——由持久事件派生，bridge 不合成通知；queued 切换的更新随提交到点到达，noop / cancelled 无更新。

**计划评审复用审批通道**：bridge 在连接上注册既有 `user-questions/request` 瀑布应答者（与审批瀑布同一注册与释放模式）。拦截条件收窄：bridge 自有会话 + 恰含一个问题 + `intent.kind === 'plan-review'`；其余请求一律放行既有瀑布（无应答者 → `NO_PROVIDER`，REQ-D6 范围不变）。转换规则：`Approve` 选项 → `{ optionId: 'approve', name: 'Approve', kind: 'allow_once' }`；`Keep planning` → `{ optionId: 'keep-planning', name: 'Keep planning', kind: 'reject_once' }`；`toolCall.toolCallId` 取 intent 的 callId；发送前 `drainUpdates()` 保证工具调用卡片先于评审卡片。应答映射：`approve` 选中 → `selected: ['Approve']`；其余 optionId 选中 → `selected: ['Keep planning']`；outcome cancelled → `ASK_CANCELLED`（命中 `exit_plan_mode` 既有「用户收回回合」分支，会话继续）。客户端以 optionId 词表区分评审卡片与工具授权卡片（`approve` / `keep-planning` 不出现在工具授权中）。

### 边界与语义明示

- **强制只读不在本期**：plan mode 自身不读 sandbox/审批状态（每个工具仍可用，仅提示约束）；需要强制保障的场景按 REQ-D5 附注以 mode→preset 联动配置承载（与 `permission_preset` 同形态），需求方提出时另立项。
- **自有 UI 通道不变**：`/plan` 命令、web 投影 `{ active, pending }`、`exit_plan_mode` 工具目录（稳定工具面）均不受影响；ACP 面是模式状态的另一个只读/控制消费者。
- **零持久化面变更**：`plan/mode` 事件与 `plan` 投影自 S11 存在；本变更不新增事件类型，Session format 维持 4。

### 验收条件（交互级）

##### 正常：modes 广告与词表
- **GIVEN** 客户端创建或恢复会话
- **WHEN** 读取 new / resume 响应的 `modes`
- **THEN** availableModes 为 plan / normal 二值且描述齐全；currentModeId 为已提交状态；新会话为 normal
##### 正常：set_mode 往返与更新时序
- **GIVEN** 空闲会话切换模式、重复设置、回合中切换
- **WHEN** 调用 `session/set_mode` 并观察 `current_mode_update`
- **THEN** 回合间立即提交并紧随更新；noop / cancelled 无更新；回合中响应先行、更新随 accepted pre-step 到达
##### 正常：计划评审三态闭环
- **GIVEN** 计划模式下模型提交计划
- **WHEN** 客户端分别应答 approve / keep-planning / 取消
- **THEN** approve 退出计划模式、keep-planning 反馈回模型且模式不变、取消按用户收回回合处理且会话继续
##### 异常：错误分支与插件缺席
- **GIVEN** 未知会话、未知 modeId、plan-mode 插件缺席
- **WHEN** `session/set_mode` 或读取 `modes`
- **THEN** 三类分支分别返回约定错误且不静默降级；插件缺席时 `modes` 字段整体省略
##### 回归：既有面不变
- **GIVEN** 既有 ACP 客户端与 dsh 自有 UI
- **WHEN** 执行 S03/S11/S49/S50 回归
- **THEN** 既有方法结构不变、`/plan` 命令与投影不变、plan-review 之外的问题仍 `NO_PROVIDER`
```

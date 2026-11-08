# core S54（goal 完成授权经 ACP 客户端应答）— 测试用例

> 来源：变更 `dsh-acp-goal-approval`。场景来源 `core-01-requirements.md` §S54；场景实现见 `core-S54-acp-goal-approval.md`。
> steer 消息与工具结果文本为模型可见文本，由 keyless recorded-session 快照新场景固定（含 snapshot harness 应答支持，随本变更交付）；配置面零变化，无 config-catalog 影响。

## S54: goal 完成授权经 ACP 客户端应答

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S54-01 | 征求与授权回传全路径 | tool-goal + user-questions（真实组合） | 有 userQuestions 通道的组合，模型调用未授权 `complete` | 捕获 ask 请求 → 以 test 应答器回答 Authorize → 检查回合与重调 | ask 指名 goal 标题与操作、intent `goal-review` 且 `approve` 命名选项；Authorize 后开放回合内出现源 user 的注入 `user/message`（工具结果之后提交）；工具结果指向重调；重调经 direct-human 完成 |
| UT-S54-02 | Deny 保持既有拒绝 | tool-goal | 同上 | 应答 Deny | 无注入消息；工具返回注明人类已拒绝的 `GOAL_TOOL_AUTHORITY_REQUIRED`；goal 状态不变 |
| UT-S54-03 | 无通道 fail-fast | tool-goal（无 userQuestions 组合） | headless 形态 | 调用未授权 `complete` | 立即 `GOAL_TOOL_AUTHORITY_REQUIRED`，无 ask、无挂起（行为与既往一致） |
| UT-S54-04 | 取消（ASK_CANCELLED）友好化 | tool-goal | 有通道组合 | 收起卡片（取消征求） | 工具失败文本与 plan-mode 同构（指名人类改发言），无注入；回合取消经 signal 干净收敛 |
| UT-S54-05 | 已授权路径不征求 | tool-goal + goal-round-driver | admitted round 调用；以及回合内已有 direct-human 的调用 | 分别调用 `complete` | 权威门槛即通过，零 ask 请求（既有路径零扰动） |
| UT-S54-06 | 意图联合与载荷校验 | user-questions 类型 + api-catalog 编目 | `goal-review` 请求载荷；未知 kind 载荷 | 校验与编目往返 | `goal-review` 载荷通过校验且 `approve` 校验生效；未知 kind 走通用呈现契约、应答编码不变；宿主内类型扩展不触及 SDK 面 |
| UT-S54-07 | blocked 同路径与 HMR 回归 | tool-goal | 有通道组合 | 未授权 `blocked` 走 authorize/deny 两分支；dispose 挂载 fiber | blocked 与 complete 行为对称；dispose 后 ask 资源释放、后续调用干净失败 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S54-01 | goal 授权卡 ACP 全链路 | S54-AC-01/02/04 | 真实 Loader 组合的 ACP 会话（mock 模型驱动工具调用，网络通道） | prompt 驱动未授权 `complete` → 客户端收 `session/request_permission`（Authorize/Deny）→ 应答 Authorize → 等模型重调 → 重启进程 `session/resume` 复核日志 | 卡片词汇正确；Authorize 后完成提交且日志含注入 `user/message` + `user-question-reply` + 完成事件；resume 后日志投影一致；Deny 分支无注入 |

### 回归与真实验收

- 复用既有 tool-goal / goal-round-driver 用例：admitted round 与 direct-human 既有路径不变。
- 复用 UT-S49-01..07、ST-S49-01/02：userQuestions 服务与审批策略不受意图扩展影响。
- 复用 UT-S51-01..06、ST-S51-01：plan-review 意图应答不受新应答者影响（瀑布 next() 契约）。
- 复用 ST-S03-01/02：ACP 主链路（prompt/resume/configOptions）不受影响。
- SMOKE-acp-network-01..07 既有回归；SMOKE-acp-network-08 是 S54-AC-01/02 真实部署面的计划用例；staging 无交互握手时按 skip 语义如实记录，不得伪报 PASS。

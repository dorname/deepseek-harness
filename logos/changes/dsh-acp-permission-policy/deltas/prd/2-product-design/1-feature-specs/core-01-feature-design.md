# delta — core-01-feature-design.md（变更 dsh-acp-permission-policy）

## MODIFIED — 1.4 SDK / ACP 结构

- SDK 协议：newline-delimited JSON-RPC over stdio（`dsh-sdk-protocol`）；会话/事件/通知类型化（`dsh-sdk-client`、`dsh-sdk-jsonrpc-server`）。
- ACP：Agent Client Protocol 的 automation-only 子集（`dsh-acp`）。模型目录继续经 `session/new`、`session/resume` 与 `session/set_config_option` 的既有 `configOptions` 发布；目录发现错误经既有 JSON-RPC 错误返回，不新增 ACP 方法、字段或静态兜底目录。会话审批策略经同一 `configOptions` 面新增 `permission_policy` 与 `permission_preset` 两个 option id（S49，见 §9），仍不新增独立 ACP 方法。
- Python：`DeepSeekHarness`（高层 turns API）+ `HarnessClient`（低层 RPC）。

## ADDED — 9. 会话审批策略交互规格（S49）

### S49: 外部客户端配置会话审批策略 — 配置与交互规格

**配置**：`session/set_config_option` 新增两个 option id。`permission_policy` 词表为 `ask`（默认，放行既有触发源产生的询问）/ `never`（自动拒绝询问）/ `always`（每次工具调用先询问）——`always` 是本变更新增的审批策略档。`permission_preset` 值来自 permission-presets 既有预设目录（read-only / workspace-write / danger-full-access），按现行定义应用 `{sandbox, approval}` 打包，各档 approval 值不在本变更中重定义。两个 option 均在 `session/new` 与 `session/resume` 的 `configOptions` 中广告当前值与可选目录。

**内部接口**：bridge 在 `setSessionConfigOption` 中先于模型选项委托处理这两个 id，调用既有 `ApprovalService.setPolicy` 与 permission-presets 既有写路径；`always` 档由 pre-execute 对每次工具调用产生询问并路由进既有 serviceAsk 管线。策略切换落既有 `approval/policy` 会话事件（LAST-wins 折叠）并注入模型可见切换通知，resume 经既有投影折叠恢复；`always` 作为该事件新枚举值，实现期按 required-on-read 语义完成读兼容评估，必要时标记 `ignorable: true`。本变更不新增 Session 事件类型、ACP 方法或 TypeScript/Python SDK 会话接口；如实现触及 `SessionEventMap`，必须在同一切片补充双 SDK expected outputs。

### 审批交互规则

- 权限应答保持一次性语义：allow-once（当次执行）/ reject-once（当次拒绝，工具失败反馈，会话与回合继续）；不提供 `allow_always` 持久授权选项。
- `always` 询问在工具执行前发起，客户端先收到该 turn 之前的全部 `session/update`（沿用既有 drainUpdates 顺序）。
- 客户端未实现 `session/request_permission` 时沿用 fail-closed：该次工具调用被拒，会话不中断，不降级放行。
- 类别级询问（ask-writes / ask-network）不在本变更范围；全仓无工具类别分类法，sandbox 词表无网络维度。

### 验收条件（交互级）

##### 正常：策略设置与回显
- **GIVEN** 客户端在会话上设置 `permission_policy=always` 并读取 configOptions
- **WHEN** 设置成功后再次读取
- **THEN** 设置被接受且 configOptions 回显 `always`；会话日志含 `approval/policy` 事件与模型可见切换通知
##### 正常：always 触发一次性审批
- **GIVEN** 会话策略为 `always`
- **WHEN** agent 执行文件写，客户端先 allow-once 后对第二次调用 reject-once
- **THEN** 第一次调用执行，第二次调用被拒且模型收到拒绝反馈后继续；两次询问均含工具调用信息与两个一次性选项
##### 异常：未知值拒绝
- **GIVEN** 客户端设置 `permission_policy=paranoid` 或未知预设
- **WHEN** `session/set_config_option`
- **THEN** 返回 invalid params 类错误，当前策略不变，不静默忽略
##### 回归：默认行为不变
- **GIVEN** 未设置策略的既有 ACP、dspm 会话
- **WHEN** 执行既有主链路、审批与升权回归
- **THEN** configOptions 新增 option 不破坏既有客户端解析，默认放行语义与升级前一致

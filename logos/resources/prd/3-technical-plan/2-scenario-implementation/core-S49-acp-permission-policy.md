# core S49: 外部客户端配置会话审批策略与预设（场景实现）

> 来源：变更 `dsh-acp-permission-policy`。场景定义见 `core-01-requirements.md` §S49；交互规格见 `core-01-feature-design.md` §9。

## 1. 参与者

| 参与者 | 职责 |
|---|---|
| 外部 ACP 客户端（dspm） | 设置会话审批策略/预设、接收 `session/request_permission` 并返回一次性应答 |
| `AcpBridge.setSessionConfigOption` | 识别并校验 `permission_policy` / `permission_preset`，未知值 fail-loud |
| `ApprovalService` | 既有 `setPolicy` 落事件、注入模型可见切换通知；`effectivePolicy` 折叠生效档 |
| always 询问源（pre-execute 监听） | `always` 档下对每次工具调用产生询问并路由进既有 serviceAsk 管线 |
| 权限预设服务 | `catalog()` 枚举预设目录、`set()` 应用 `{sandbox, approval}` 打包 |
| 权限回环 answerer | 既有 `session/request_permission` 投递与 allow-once/reject-once 结算 |

## 2. 配置与词表

1. `permission_policy` 词表：`ask`（默认，放行既有触发源产生的询问）、`never`（自动拒绝询问）、`always`（每次工具调用先询问）。`always` 为本变更新增档，写入既有 `approval/policy` 事件；读侧按 required-on-read 语义完成兼容评估，必要时标记 `ignorable: true`。
2. `permission_preset` 值域为 permission-presets 既有预设目录（read-only / workspace-write / danger-full-access），目录经 `catalog()` 动态枚举；应用走既有 `set()`，各档 `{sandbox, approval}` 值沿用现行定义，不在本变更中重定义。
3. 两个 option 在 `session/new`、`session/resume` 的 configOptions 广告当前值；策略与预设状态经既有会话事件折叠在 resume 恢复，不新增存储。
4. 设置走 bridge `setSessionConfigOption` 的策略分支（先于模型选项委托）；序列化沿用既有 promise tail，并发设置不交错。

## 3. 主路径时序

```mermaid
sequenceDiagram
  participant C as ACP client (dspm)
  participant B as AcpBridge
  participant A as ApprovalService
  participant P as pre-execute ask source
  participant T as Tool execution

  C->>B: set_config_option(permission_policy=always)
  B->>B: validate vocabulary (unknown → invalid params)
  B->>A: setPolicy(agent, 'always')
  A->>A: append approval/policy event + model-visible switch notice
  B-->>C: ok; configOptions reflect always
  C->>B: session/prompt (tool-using turn)
  T->>P: tool call about to execute
  P->>A: serviceAsk (per call)
  A->>B: approval/request (waterfall answerer)
  B->>C: session/request_permission (allow-once / reject-once)
  alt allow-once
    C-->>B: outcome allowed
    B-->>A: granted once
    T->>T: execute
  else reject-once
    C-->>B: outcome rejected
    B-->>A: denied once
    T-->>T: call fails with denial; turn continues
  end
```

## 4. 策略档分发语义

- `always`：每次工具调用（含文件写、网络、终端）执行前产生询问；这是默认配置下首个覆盖普通调用的触发源，dspm 验收场景（配置后文件写触发审批）由此满足。
- `never`：既有触发源（PreToolUse hook ask、auto-review、sandbox 升权直通审批）产生的询问一律自动拒绝，不发起 `session/request_permission`。
- `ask`（默认）：维持既有放行语义——无触发源的普通调用不询问；触发源询问正常送达客户端。未配置策略的会话行为与升级前一致。
- 权限应答保持一次性：allow-once 仅当次生效，reject-once 仅当次拒绝；不提供 `allow_always`，不在 bridge 推断持久授权。

## 5. 错误与边界

- 未知策略值、未知预设名：invalid params 类 JSON-RPC 错误，策略与预设状态不变，不静默忽略。
- 审批或预设插件未组装、预设目录为空：显式失败，不吞错、不回退默认。
- 客户端未实现 `session/request_permission`：沿用 fail-closed，该次调用被拒，会话与回合不中断，不降级放行。
- 类别级询问（ask-writes / ask-network）不在本场景：无工具类别分类法、sandbox 无网络维度；`/permission` 命令与 profile 会话种子行为不变。

## 6. 验收条件映射

| AC | 覆盖测试 |
|---|---|
| S49-AC 词表校验与 fail-loud | UT-S49-01 |
| S49-AC always 全量询问与一次性应答 | UT-S49-02、ST-S49-01 |
| S49-AC never 自动拒绝 | UT-S49-03、ST-S49-02 |
| S49-AC 事件落库、通知与 resume 恢复 | UT-S49-04、UT-S49-05、ST-S49-02 |
| S49-AC 预设应用与目录枚举 | UT-S49-06 |
| S49-AC 真实组合与快照 | UT-S49-07、SMOKE-acp-network-03 |
| S03/S21/S22 回归 | ST-S03-01、ST-S03-02、UT-S21-01、UT-S21-02、ST-S21-01、ST-S21-02、ST-S22-01、ST-S22-02 |

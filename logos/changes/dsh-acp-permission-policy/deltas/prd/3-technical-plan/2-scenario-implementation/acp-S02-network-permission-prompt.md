# delta — acp-S02-network-permission-prompt.md（变更 dsh-acp-permission-policy）

## ADDED — 审批策略档衔接（S49）

S49 复用本场景的 `session/request_permission` 双向帧回环，不新增 server→client 请求形态；新增的是**触发源**与会话级策略档：

1. 会话审批策略经 `session/set_config_option { permission_policy }` 配置，词表 `ask`（默认放行）/ `never`（自动拒绝询问）/ `always`（每次工具调用先询问）；策略经策略事件对持久化（ask/never 落既有 `approval/policy`，always 落新增 `approval/policy-always`），resume 折叠恢复。
2. `always` 是默认配置下首个覆盖普通工具调用的触发源：策略生效后每次调用在执行前走既有「approval/request → drainUpdates → request_permission → 应答结算」链路，本场景时序图中的投递与结算步骤原样适用。
3. `never` 档在服务端吞掉询问（不发起 `session/request_permission`）；`ask` 档维持现状——普通调用不询问，仅既有触发源（hook ask、auto-review、sandbox 升权）产生询问。
4. 应答选项保持一次性语义（allowed-once / rejected / cancelled），不提供持久授权选项；客户端未实现回调时沿用 fail-closed 拒绝该次调用。
5. `session/new` 与 `session/resume` 的 `configOptions` 广告策略当前值与 `permission_preset` 预设目录（read-only / workspace-write / danger-full-access），供外部客户端枚举与切换。

对应覆盖：UT-S49-02、UT-S49-03、ST-S49-01、ST-S49-02、SMOKE-acp-network-03，并复用 UT-S01、UT-S03、ST-S01、ST-S02 验证既有连接、resume 与权限回环行为。

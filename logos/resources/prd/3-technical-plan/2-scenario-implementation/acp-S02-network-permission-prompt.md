# 场景 S02：网络 ACP 权限确认回环

> 变更：20261020-1643-acp-over-network

## 目标

描述 ACP server 通过 WebSocket 双向帧向 client 发起 `session/request_permission`，client 返回决策后 server 继续执行 turn 的时序。

## 时序图

```text
Client                          dsh-acp-network                AcpBridge          UserApproval
  |                                     |                         |                    |
  |=== 已建立 WebSocket 连接 ===========|                         |                    |
  |                                     |                         |                    |
  |--- session/prompt {sessionId} ----->|                         |                    |
  |                                     |--- prompt() ------------->|                    |
  |                                     |                         |--- queue user msg   |
  |                                     |                         |--- tool call needs permission
  |                                     |                         |--- emit approval/request
  |                                     |                         |                    |
  |                                     |                         |<-- approval/request --|
  |                                     |--- drainUpdates() --------|                    |
  |                                     |--- request(methods.client.session.requestPermission)
  |                                     |                         |                    |
  |<-- session/request_permission {toolCallId, options} -------------|                    |
  |                                     |                         |                    |
  |--- session/request_permission response {outcome} -------------->|                    |
  |                                     |--- map outcome to 'allowed-once' / 'rejected' / 'cancelled'
  |                                     |--- resume waterfall      |                    |
  |                                     |                         |--- grant/reject once |
  |                                     |                         |--- continue turn     |
  |<-- session/update (tool_call, tool_call_update, ...) -----------|                    |
  |<-- session/prompt response {stopReason} ------------------------|                    |
```

## 关键设计决策

1. **双向帧天然支持 server→client 请求**：WebSocket 模式下，`session/request_permission` 作为 JSON-RPC request 从 server 发往 client，client 必须返回 response；HTTP fallback 下该场景依赖 SSE/POST 轮询，本期优先 WebSocket。
2. **桥接只提供一次性选项**：`allowed-once`、`rejected`、`cancelled`，不推断持久授权；与 dsh-subagent-acp 语义一致。
3. **更新顺序**：在发起权限请求前调用 `record.drainUpdates()`，确保 client 已收到该 turn 之前的所有 `session/update`，避免权限弹窗与未读内容交错。

## 验收标准

- UT-S02：权限请求经 WebSocket 送达测试 client，client 返回 `cancelled` 后 turn 按取消/拒绝结算。
- ST-S02：staging 中权限确认双向帧在 5s 内完成往返。

## 审批策略档衔接（S49）

S49 复用本场景的 `session/request_permission` 双向帧回环，不新增 server→client 请求形态；新增的是**触发源**与会话级策略档：

1. 会话审批策略经 `session/set_config_option { permission_policy }` 配置，词表 `ask`（默认放行）/ `never`（自动拒绝询问）/ `always`（每次工具调用先询问）；策略经既有 `approval/policy` 会话事件持久化，resume 折叠恢复。
2. `always` 是默认配置下首个覆盖普通工具调用的触发源：策略生效后每次调用在执行前走既有「approval/request → drainUpdates → request_permission → 应答结算」链路，本场景时序图中的投递与结算步骤原样适用。
3. `never` 档在服务端吞掉询问（不发起 `session/request_permission`）；`ask` 档维持现状——普通调用不询问，仅既有触发源（hook ask、auto-review、sandbox 升权）产生询问。
4. 应答选项保持一次性语义（allowed-once / rejected / cancelled），不提供持久授权选项；客户端未实现回调时沿用 fail-closed 拒绝该次调用。
5. `session/new` 与 `session/resume` 的 `configOptions` 广告策略当前值与 `permission_preset` 预设目录（read-only / workspace-write / danger-full-access），供外部客户端枚举与切换。

对应覆盖：UT-S49-02、UT-S49-03、ST-S49-01、ST-S49-02、SMOKE-acp-network-03，并复用 UT-S01、UT-S03、ST-S01、ST-S02 验证既有连接、resume 与权限回环行为。

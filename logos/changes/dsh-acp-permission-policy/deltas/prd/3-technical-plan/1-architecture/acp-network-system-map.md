# delta — acp-network-system-map.md（变更 dsh-acp-permission-policy）

## ADDED — 会话审批策略配置面（S49）

网络 ACP 与 stdio ACP 共用 `AcpBridge` 的配置入口，因此审批策略配置不需要新增网络路由、ACP 方法或 dspm 侧协议复制。`session/set_config_option` 新增 `permission_policy`（`ask`/`never`/`always`）与 `permission_preset`（permission-presets 预设目录）两个 option id；`session/new` 与 `session/resume` 的 `configOptions` 广告当前值与预设可选目录。

```text
Client                         AcpBridge.setSessionConfigOption      ApprovalService / Presets
  │ set_config_option(permission_policy|permission_preset)
  │──────────────────────────────────────────▶│
  │                                           │ 校验词表/预设目录（未知值 → invalid params）
  │                                           │── setPolicy / preset set() ──▶
  │                                           │◀── approval/policy 事件 + 切换通知 ──
  │◀── 设置回执 + configOptions 当前值 ────────│
  │                                           │
  │◀── session/request_permission（策略触发时，既有回环）──▶│
  │─── allow-once / reject-once ─────────────▶│ 一次性应答结算
```

- 策略与预设状态经既有 `approval/policy` 会话事件持久化，resume 经既有投影折叠恢复；`always` 新枚举值按 required-on-read 语义完成读兼容评估。
- `always` 档下每次工具调用在执行前发起 `session/request_permission`；发起前沿用既有 drainUpdates 顺序，客户端先收到该 turn 之前的全部更新。
- 未实现 `session/request_permission` 的客户端沿用 fail-closed：该次调用被拒，会话不中断，不降级放行。
- 既有网络认证、连接隔离和会话持久化机制不变；审批策略是会话级状态，不引入跨用户或跨实例的新授权面，token 授权边界不变。

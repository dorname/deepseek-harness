# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-plan-mode）

## ADDED — SMOKE-acp-network-05：会话计划模式面

在 SMOKE-acp-network-04 之后追加：

```markdown
## SMOKE-acp-network-05：会话计划模式面

### 目的

验证 staging 部署面上，外部客户端可经标准方法 `session/set_mode` 感知与切换 dsh 计划模式，`modes` 广告与 `current_mode_update` 时序符合规格，错误分支生效，且既有通道与会话行为不受影响。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `dsh-base`（默认即挂载 `@deepseek-ai/dsh-plan-mode`）。

### 步骤

1. 连接并认证，`session/new`，读取响应 `modes`。
2. `session/set_mode { modeId: 'plan' }`，观察 `session/update` 的 `current_mode_update`。
3. `session/resume`（断连重连），读取响应 `modes`。
4. `session/set_mode { modeId: 'normal' }`，观察更新；随后重复设置 `normal` 一次。
5. `session/set_mode { modeId: 'plan' }` + `session/set_mode { modeId: 'other' }` 验证词表错误分支。
6. 正常 prompt 往返一次。

### 期望结果

- 第 1 步 `modes.availableModes` 恰为 plan / normal 二值（含 name），`currentModeId` 为 `normal`。
- 第 2 步响应立即返回且恰伴随一次 `current_mode_update(plan)`。
- 第 3 步 resume 后 `currentModeId` 为 `plan`。
- 第 4 步切回 normal 紧随一次更新；重复设置无新更新。
- 第 5 步 plan 正常提交；`other` 返回 invalid params 类错误且消息含 plan/normal 词表。
- 第 6 步 prompt 正常结算；SMOKE-acp-network-01..04 既有行为不受影响。
```

## MODIFIED — 失败判定

追加一条：

```markdown
- SMOKE-acp-network-05 中：`modes` 广告缺失或词表不合法，`set_mode` 后无 `current_mode_update` 或出现冗余更新，resume 后模式未恢复，或未知 modeId 未返回含词表的 invalid params 类错误。
```

## MODIFIED — 执行方式

本地一行更新为（其余不变）：

```markdown
- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返、SMOKE-acp-network-04 技能清单枚举与 SMOKE-acp-network-05 计划模式面；plan-review 评审映射依赖模型行为，不在本地 smoke，由单元与真实 API e2e 承载）。
```

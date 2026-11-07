# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-skills-list）

## ADDED — SMOKE-acp-network-04：会话技能清单枚举

在 SMOKE-acp-network-03 之后追加：

```markdown
## SMOKE-acp-network-04：会话技能清单枚举

### 目的

验证 staging 部署面上，外部客户端可经 `session/skills_list` 枚举会话可见技能清单及双调用旗标，未知会话错误分支生效，且既有通道与会话行为不受影响。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `dsh-base`（默认即挂载 `@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-skill-filesystem`）。

### 步骤

1. 连接并认证，`session/new`。
2. `session/skills_list { sessionId }`。
3. 对部署环境已知技能目录（用户级根目录）核对清单一致性。
4. `session/skills_list { sessionId: 'unknown-id' }` 验证错误分支。
5. 正常 prompt 往返一次，随后再次 `session/skills_list`。

### 期望结果

- 第 2 步返回 `{ skills: [...] }` 数组，按名字典序排列，每项恰含 `name`、`description`、`modelInvocable`、`userInvocable`；与已知技能目录一致（部署环境无技能时合法返回空数组）。
- 第 4 步返回 invalid params 类错误。
- 第 5 步 prompt 正常结算，再次枚举与第 2 步一致；既有 prompt/resume 行为不受影响。
```

## MODIFIED — 失败判定

追加一条：

```markdown
- SMOKE-acp-network-04 中：`skills_list` 响应结构不合法（非数组、缺字段、乱序），已知技能缺席，或未知会话未返回错误。
```

## MODIFIED — 执行方式

本地一行更新为（其余不变）：

```markdown
- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返与 SMOKE-acp-network-04 技能清单枚举；无 answerer 的 fail-closed 分支在单元层覆盖，不在本地 smoke 重复）。
```

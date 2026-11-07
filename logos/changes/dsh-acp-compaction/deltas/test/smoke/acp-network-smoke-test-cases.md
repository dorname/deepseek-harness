# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-compaction）

## ADDED — SMOKE-acp-network-06：会话压缩面

在 SMOKE-acp-network-05 之后追加：

```markdown
## SMOKE-acp-network-06：会话压缩面

### 目的

验证 staging 部署面上，外部客户端可经 `session/compact` 触发原生压缩并取得结构化结果，busy 竞态与错误分支生效，能力门控通知正确隔离，且既有通道与会话行为不受影响。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `dsh-base`（默认即挂载 `@deepseek-ai/dsh-compaction-basic`）与可用真实模型（压缩执行需要真实历史）。

### 步骤

1. 连接并认证（声明 `clientCapabilities.session.compaction`），`session/new`。
2. 真实模型 prompt 数轮产生可压缩历史。
3. `session/compact { sessionId }`，观察响应与 `compaction_update` 通知序列。
4. 压缩进行中并发第二次 `session/compact`（竞态窗口内）。
5. `session/resume` 后检查历史已替换；新开无历史会话调用 `session/compact`。
6. `session/compact { sessionId: 'unknown-id' }` 验证错误分支。
7. 另建一条未声明 compaction 能力的连接执行同样压缩，观察通知。
8. 正常 prompt 往返一次。

### 期望结果

- 第 3 步响应含 compactionId / summarySeq / shadowedCount / shadowedTokenCount / summary；通知按 in_progress → completed（含摘要块）到达。
- 第 4 步竞态调用返回 `data.code: 'busy'`（竞态窗口未命中时如实记录，不得伪报）。
- 第 5 步 resume 后表面已被摘要替换；无历史会话合法返回 `{ result: null }`。
- 第 6 步返回 invalid params 类错误。
- 第 7 步未声明能力的连接全程零 `compaction_update`。
- 第 8 步 prompt 正常结算；SMOKE-acp-network-01..05 既有行为不受影响。
```

## MODIFIED — 失败判定

追加一条：

```markdown
- SMOKE-acp-network-06 中：压缩响应结构不合法（缺字段、类型错误），`{ result: null }` 被报为错误，竞态 busy 分支未生效（窗口命中时），未声明能力的连接收到 `compaction_update`，或已知历史压缩后 resume 未替换。
```

## MODIFIED — 执行方式

本地一行更新为（其余不变）：

```markdown
- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返、SMOKE-acp-network-04 技能清单枚举、SMOKE-acp-network-05 计划模式面与 SMOKE-acp-network-06 压缩面；压缩执行需真实模型产历史，无 key 环境按既有 skip 语义如实跳过）。
```

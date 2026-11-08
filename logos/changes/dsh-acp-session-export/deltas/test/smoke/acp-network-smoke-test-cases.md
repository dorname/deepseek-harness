# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-session-export）

## MODIFIED — Gate 判定（清单追加一行）

在 Gate 判定清单 SMOKE-acp-network-08 行后追加：

```markdown
- SMOKE-acp-network-09 中：导出往返失败（`export_begin` 前置应答缺失、read 载荷超分块上界、eof 后游标未失效），或 cancel/未知游标未返回 `unknown_cursor`/空结果词表，或未知会话 begin 未得 invalid params。
```

## MODIFIED — 执行方式（源码清单行更新）

将执行方式节的源码行整行替换为：

```markdown
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返、SMOKE-acp-network-04 技能清单枚举、SMOKE-acp-network-05 计划模式面、SMOKE-acp-network-06 压缩面、SMOKE-acp-network-07 多供应商路由供给面、SMOKE-acp-network-08 goal 授权卡往返面与 SMOKE-acp-network-09 会话导出往返面；06 压缩执行需真实模型产历史、07 需本地数组组合与 mock HTTP 供应商后端、08 需本地 goal 组合与交互握手、09 为纯方法调用无需交互握手，无对应条件的环境按既有 skip 语义如实跳过）。
```

## ADDED — SMOKE-acp-network-09：会话导出往返面

在文件末尾、SMOKE-acp-network-08 节之后追加：

```markdown
## SMOKE-acp-network-09：会话导出往返面

### 目的

验证 ACP 连接内导出三方法往返：`export_begin` → `export_read` 至 eof 产出与 HTTP 路由同工件的 ZIP 归档，cancel/unknown_cursor 错误词表正确。导出是纯方法调用、无交互握手——staging 具备条件即执行（同 SMOKE-acp-network-05 先例），不满足时按既有 skip 语义如实记录，永不报 PASS。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）；本地组合用 mock LLM 后端驱动会话事件，staging 用真实模型 prompt 产事件即可。

### 步骤

1. `session/new` → prompt 驱动若干事件（本地 mock 模型；staging 真实模型短 prompt）。
2. `session/export_begin { sessionId }` → 核对 `{ exportId, filename }`（`dsh-session-<id>.zip` 命名）。
3. `session/export_read { exportId }` 循环至 `eof: true` → 累积 base64 解码写临时文件 → 解包核对 `session.v4.jsonl` 首条目存在且含步骤 1 驱动期事件。
4. eof 后再次 `export_read` 核对 `data.code: 'unknown_cursor'`；新 `export_begin` 后立即 `export_cancel` → read 核对同一词表、cancel 返回空结果。
5. 对未知 sessionId `export_begin` 核对 invalid params；对伪造游标 id `export_read`/`export_cancel` 核对 `unknown_cursor`。

### 期望

- 步骤 2/3：导出往返全链路成功；每 read 载荷不超过配置分块的 base64 膨胀上界；归档布局与 HTTP 路由一致（`session.v4.jsonl` 首条目）。
- 步骤 4/5：终态游标与未知游标全部 `unknown_cursor`，cancel 空结果，未知会话 invalid params——错误词表无越界。
- SMOKE-acp-network-01..08 既有通道不受影响（第三组扩展方法注册零扰动）。
```

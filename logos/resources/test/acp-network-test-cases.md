# ACP-over-network 测试用例

> 变更：20261020-1643-acp-over-network

## 单元（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S01 | WebSocket 完整 prompt 闭环 | `packages/acp/acp-network/tests/network.spec.ts` | mock LLM 返回 `hello from network` | initialize → authenticate → session/new → session/prompt → session/close | `sessionId` 有效；`stopReason === end_turn`；文本更新拼接为 `hello from network` |
| UT-S02 | 认证失败 | `packages/acp/acp-network/tests/network.spec.ts` | 无效或过期 token | initialize → authenticate | `authenticate` 抛错 |
| UT-S03 | 断连后 resume | `packages/acp/acp-network/tests/network.spec.ts` | 同一 persistence root | session/new → prompt → close → 新 harness session/resume → prompt | resume 成功；prompt 返回 `end_turn` |
| UT-S04 | bundle 配置声明 | `packages/bundle/acp-network-app/tests/acp-network-app.spec.ts` | `cordis.patch.yml` | 读取 patch | 声明 `acp-network-app-startup` 与 `acp-network`；transport=`websocket`；path=`/acp`；`acp` 与 `session-title-llm` 禁用 |

## 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S01 | 网络 ACP 端到端 prompt | SMOKE-acp-network-01 | 本地协议 smoke 或 staging | initialize → authenticate → session/new → session/prompt | 文本更新与 `end_turn` |
| ST-S02 | 断连后 session/resume | SMOKE-acp-network-02 | 本地协议 smoke 或 staging | close → 新连接 → resume → prompt | resume 成功；新 prompt 正常返回 |

## 追溯表

| 需求/场景 | 对应代码/测试 | 状态 |
|-----------|---------------|------|
| WebSocket 传输 | `packages/acp/acp-network/src/index.ts` | 已实现 |
| Streamable HTTP fallback | `packages/acp/acp-network/src/index.ts` | 已实现 |
| HMAC token 认证 | `packages/acp/acp-network/src/index.ts` | 已实现 |
| session/new + prompt | UT-S01 | 验收接线 |
| 认证失败 | UT-S02 | 验收接线 |
| session/resume | UT-S03 | 验收接线 |
| bundle 声明 | UT-S04 | 验收接线 |
| staging/local smoke prompt | ST-S01 / SMOKE-acp-network-01 | 验收接线 |
| staging/local smoke resume | ST-S02 / SMOKE-acp-network-02 | 验收接线 |

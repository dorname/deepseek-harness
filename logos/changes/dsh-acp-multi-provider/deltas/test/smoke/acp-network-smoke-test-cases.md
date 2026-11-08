# delta — acp-network-smoke-test-cases.md（变更 dsh-acp-multi-provider）

## ADDED — SMOKE-acp-network-07：多供应商路由供给与切换面

在 SMOKE-acp-network-06 之后追加：

```markdown
## SMOKE-acp-network-07：多供应商路由供给与切换面

### 目的

验证部署组合以数组形式供给多供应商路由时，网络 ACP 面的分组广告、跨供应商切换与 resume 持久生效，形态冲突在加载期指名失败。

### 前置条件

- 同 SMOKE-acp-network-01（已部署目标 commit、HMAC token、`DSH_ACP_NETWORK_SECRET` 配置）。
- 部署组合含 `llm-pi-ai` 且其 `providers` 以数组形式供给两个本地 mock 供应商路由（mock HTTP 后端，apiKeyEnv 指向本地凭据）。staging 默认组合无数组供给时按 skip 语义记录，永不报 PASS。

### 步骤

1. 以数组组合启动实例，WebSocket 连接并认证，`session/new`。
2. 核对响应 configOptions：模型选项按两个供应商分组呈现，默认路由为 provider/model 值对所指路由。
3. `set_config_option` 切换到另一供应商的模型，prompt 往返一次。
4. 断开重连，`session/resume`，核对模型选择保持。
5. 以冲突组合（数组与 dict 同供）独立启动第二实例，观察加载失败。
6. 正常 prompt 往返一次（默认路由）。

### 期望结果

- 第 2 步 configOptions 两供应商分组齐全，选项值编码与既有 modelValue 一致。
- 第 3 步切换生效，mock 后端收到被切换路由的请求。
- 第 4 步 resume 后选择保持（经 EpochHeader 恢复）。
- 第 5 步加载失败诊断指名数组与 dict 冲突来源。
- 第 6 步正常结算；SMOKE-acp-network-01..06 既有行为不受影响。
```

## MODIFIED — 失败判定

追加一条：

```markdown
- SMOKE-acp-network-07 中：configOptions 分组缺失或错组、切换未命中被选路由、resume 后选择丢失，或冲突组合未在加载期指名失败。
```

## MODIFIED — 执行方式

本地一行更新为（其余不变）：

```markdown
- 本地：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - 源码：`packages/acp/acp-network/tests/smoke/protocol-smoke.ts`（含 SMOKE-acp-network-03 审批策略往返、SMOKE-acp-network-04 技能清单枚举、SMOKE-acp-network-05 计划模式面、SMOKE-acp-network-06 压缩面与 SMOKE-acp-network-07 多供应商路由供给面；07 需本地数组组合与 mock HTTP 供应商后端，无该组合的环境按既有 skip 语义如实跳过）。
```

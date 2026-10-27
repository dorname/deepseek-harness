# 合并指令

## 变更提案
- 提案名称：20261020-1643-acp-over-network
- 提案目录：logos/changes/20261020-1643-acp-over-network/

## 提案内容

# 变更提案：ACP-over-network

> module: acp | created: 2026-10-20

## 变更原因

DSPM 智能体平台采用"每用户一个 dsh 逻辑实例"架构：dspm 后端为共享多副本服务，dsh 实例为 per-user Pod，二者不可能同 Pod。当前 `packages/acp/acp` 仅支持 JSON-RPC over stdio，spike/本地形态无法直接用于 Pod 部署。虽然 `@agentclientprotocol/sdk@1.4.0` 已自带实验性 Streamable HTTP 与 WebSocket 传输，但仓库尚未使用；dsh 需要把网络传输接入 Cordis webserver、补上安全模型（凭证签发/轮换/授权边界/防重放）、并调整 session 与 connection 的生命周期语义，才能成为 DSPM 阶段 2 的正式通道。

本变更对应 DSPM 设计文档决策六（v0.6 已定）：relay→运行时驱动通道 = ACP-over-network。

## 变更类型

架构级 + 代码级 + 安全模型设计：复用 ACP SDK 实验网络传输，新增 dsh 侧网络 ACP server 插件、安全模型、与 Cordis webserver 集成；同步更新规格、测试与 smoke。

## 变更范围

- 影响的需求文档：无新增业务需求（ACP 语义保持不变）。
- 影响的功能规格：DSPM 设计文档 §5.6/§7.2 落地要求中"dsh 侧 ACP-over-network 交付"部分。
- 影响的 API：ACP 协议面仍为 ACP v1；新增网络传输入口、认证方法、`initialize` 能力广告变化。
- 影响的 DB 表：无（不依赖 PG 表结构；安全凭证短期存活，由部署侧 secret/token 机制承载）。
- 影响的编排测试：无。
- 影响的 smoke 测试：新增 SMOKE-acp-network-01/02（网络 ACP 端到端、断连重连 resume）。

新组件（1–2 个新包，均不改既有缝签名与 `agent-loop`）：

1. `packages/acp/acp-network`（`@deepseek-ai/dsh-acp-network`，建议新增）：网络 ACP 传输插件——在 Cordis `ctx.webServer` 上注册 WebSocket upgrade route，为每个连接创建隔离的 ACP `AgentContext`；管理连接认证、多连接归属、断连不回收 session 的语义。
2. `packages/acp/acp-network-testkit`（可选）：嵌入式网络 ACP server/client 测试脚手架，供 `packages/acp/acp` 与 dspm chat relay 测试复用。

既有包改动（中）：

- `packages/acp/acp`：
  - 将 `apply` 中的 connection/session 绑定解耦：支持"server 实例持有多个 connection，每个 connection 可管理多个 session；connection 断开只停止向该 connection 投递更新，不关闭 session"。
  - 为 `authenticate` 提供真正的凭证校验钩子（默认保持无认证，网络模式下由 `dsh-acp-network` 注入验证器）。
  - 在 `initialize` 能力广告中可选增加 `loadSession`（与 SDK 推荐的 reconnect 流程对齐；若裁剪，则 reconnect 走 `session/resume`）。
  - 保留 stdio 形态为默认/本地形态；网络形态通过新 plugin 组合启用。
- `packages/bundle/acp-app`（或新增 `acp-network-app` bundle）：提供 `dsh --profile acp-network` 启动网络 ACP server 的 runnable composition。

## 部署影响

- 是否需要部署：是（需在 staging 验证网络 ACP 入口与 dspm chat relay 对接）。
- 部署原因：阶段 2 多用户隔离的前置依赖；必须验证 Pod 形态下 relay→实例通道的延迟、断连恢复与权限确认回环。
- 影响环境：本地 Docker Desktop Kubernetes staging（沿用 cluster-web 命名空间或新建 `dsh-acp-network-staging`）。
- 是否涉及数据迁移：否。
- 是否需要回滚预案：是；回滚到关闭网络 ACP route 的镜像 revision，或缩容网络 ACP Deployment 到 0。
- 是否需要 smoke：是。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

本次变更将 ACP 从单一 stdio 连接扩展为网络连接形态：

1. **传输层**：复用 `@agentclientprotocol/sdk` 实验性 `AcpServer` + `createWebSocketStream` / `createHttpStream`，在 dsh Cordis webserver 上暴露 WebSocket  upgrade route（首选）与 Streamable HTTP endpoint（可选）。WebSocket 双向帧天然支持 ACP 的 `session/request_permission` server→client 请求；Streamable HTTP 作为无 WebSocket 环境的 fallback。
2. **连接模型**：一个 dsh 实例进程可接受多个 ACP client connections；每个 connection 独立 `initialize`/`authenticate`，有自己的 `AgentContext`。`packages/acp/acp` 的 session registry 从"connection-owned"改为"server-owned + connection-subscribed"：connection 断开时，该 connection 上未完成的 prompts 按取消/失败结算，但已创建的 session 保持活跃，其他 connection 或同一 client 重连后可继续交互。
3. **安全模型**：
   - 认证：网络形态启用时，`authenticate` 方法校验由编排器/部署侧签发的短期 token（如 JWT 或 HMAC token），token 中携带 audience（该 dsh 实例标识）与 subject（DSH_FLEET_USER_ID）。
   - 加密：TLS 由 ingress/LoadBalancer 或 Pod 内 sidecar 终结；进程内 webserver 可默认只监听 loopback，由 K8s Service/NetworkPolicy 收敛访问面。
   - 授权边界：token 只授权"在此实例上创建/恢复属于该 subject 的 session"；`session/list` 只能看到同 subject 的会话；MCP 工具调用携带的 per-user 凭证进一步约束业务动作。
   - 防重放：token 含 `jti` + `exp`，server 端维护短期已用 `jti` 集合（内存即可，token 有效期建议 ≤5 分钟）。
4. **断连恢复**：client 保存 `sessionId`，重连后重新 `initialize` + `authenticate`，然后调用 `session/resume`（或 `session/load`）恢复。server 保持 session 活跃的条件是 dsh 进程/实例仍在运行；实例空闲回收由编排器负责，与 ACP 连接状态解耦。

范围裁剪：
- 本期优先 WebSocket 传输；Streamable HTTP 作为二期或同时开发但可延迟验收。
- 不改造 ACP 协议语义本身（仍是 automation-only）。
- 不引入新的持久化表；token 黑名单/rotation 由部署侧 secret 机制承载。
- 多连接同时操作同一会话的竞态：本期按"单连接单活跃 prompt"处理，与现有 ACP 单连接语义一致；多连接并发控制列为后续增强。

## 验收资源约束

- Staging 使用 Docker Desktop Kubernetes（沿用 cluster-web 的 4 CPU / 8 GB 约束）。
- 网络 ACP server 与 dsh API/frontend 共存于同一 Pod 或独立 Pod（按 cluster-web 形态决定）；CPU/memory 增量需实测。


## 需要合并的 Delta 文件

### 1. deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md

- Delta 文件：`logos/changes/20261020-1643-acp-over-network/deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/3-technical-plan/2-scenario-implementation/acp-S01-network-session-lifecycle.md

- Delta 文件：`logos/changes/20261020-1643-acp-over-network/deltas/prd/3-technical-plan/2-scenario-implementation/acp-S01-network-session-lifecycle.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/2-scenario-implementation/acp-S02-network-permission-prompt.md

- Delta 文件：`logos/changes/20261020-1643-acp-over-network/deltas/prd/3-technical-plan/2-scenario-implementation/acp-S02-network-permission-prompt.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md

- Delta 文件：`logos/changes/20261020-1643-acp-over-network/deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/test/acp-network-test-cases.md

- Delta 文件：`logos/changes/20261020-1643-acp-over-network/deltas/test/acp-network-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/test/smoke/acp-network-smoke-test-cases.md

- Delta 文件：`logos/changes/20261020-1643-acp-over-network/deltas/test/smoke/acp-network-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(20261020-1643-acp-over-network): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive 20261020-1643-acp-over-network`。

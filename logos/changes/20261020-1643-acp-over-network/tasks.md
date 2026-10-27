# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md`：组件表（`dsh-acp-network` 包、`dsh-acp` 改动点、WebSocket/HTTP 入口、token 认证、session/connection 生命周期）、时序图（首次连接、断连重连 resume、权限确认回环）、安全模型章节（凭证格式、签发/轮换、授权边界、防重放、TLS/NetworkPolicy）。
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/acp-S01-network-session-lifecycle.md`：S01 场景时序图（initialize → authenticate → session/new → prompt → 断连 → 重连 → session/resume）。
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/acp-S02-network-permission-prompt.md`：S02 场景时序图（server→client 的 `session/request_permission` 经 WebSocket 双向帧送达）。
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md`：Pod 形态下网络 ACP 端口暴露、Service/NetworkPolicy、token secret 注入、探针、回滚方案。
- [x] 产出 delta 文件到 `deltas/test/acp-network-test-cases.md`：UT-S01..02 / ST-S01..02 用例 + AC 追溯表。
- [x] 产出 delta 文件到 `deltas/test/smoke/acp-network-smoke-test-cases.md`：SMOKE-acp-network-01/02 端到端与断连恢复。

## [code] 代码实现
> 切片1：ACP 核心解耦（connection 与 session 生命周期分离、认证钩子）；切片2：网络传输插件（WebSocket route、AcpServer 集成、token 验证）；切片3：bundle 与 staging smoke。切片1 为被依赖片排前；切片2 依赖切片1；切片3 依赖切片2。

- [x] 切片1：`packages/acp/acp` 核心解耦
  - 抽象 `AcpBridge` 类，将 connection/session 绑定解耦到单个可复用的 bridge 实例；每个 bridge 持有独立的 `AgentContext`、session registry、与认证钩子。
  - 支持一个 server 持有多个 connection，每个 connection 由独立 `AcpBridge` 服务；`authenticate` 接入可配置的验证器（默认保持无认证，网络模式下注入 token 校验）。
  - `AcpBridge` 私有 session registry 按 `SessionId` 索引；bridge 关闭时关闭其拥有的 sessions。断连恢复通过持久化 `session/resume` 实现。
  - `initialize` 广告 resume/close/list session 能力；`session/resume` 覆盖 reconnect 场景。
  - 同步现有测试：stdio 形态行为不变；`config.stream` 测试路径继续可用。
  - 新增/更新单元测试：认证失败拒绝连接、断连后通过 `session/resume` 恢复。

- [x] 切片2：`packages/acp/acp-network` 网络传输插件
  - 新建包，依赖 `@deepseek-ai/dsh-acp`、`@agentclientprotocol/sdk`、Cordis webserver seam。
  - 实现 `apply(ctx, config)`：
    - 读取 `config.port`、`config.path`、`config.auth.validator`（函数/secret）、`config.transport`（`'websocket' | 'http' | 'both'`）。
    - 在 `ctx.webServer` 注册 WebSocket upgrade route（`prepareWebSocketUpgrade` + `Acp-Connection-Id` header）与/或 HTTP handler（`AcpServer.handleRequest`）。
    - 每个 accepted connection 调用 `AcpPlugin.apply` 的 connection factory 变体，注入 per-connection stream 和 token 验证器。
  - 提供 token 验证 helper：JWT/HMAC token 解析、audience/subject/exp/jti 校验、短期 jti 去重集合。
  - 新增单元测试：嵌入式 server/client 通过 WebSocket 走完整 ACP 会话；token 过期/错误拒绝；断连后 resume。

- [x] 切片3：bundle 与 staging smoke
  - 新增或修改 `packages/bundle/acp-network-app`（或 `packages/bundle/acp-app` patch）：`dsh --profile acp-network` 启动网络 ACP server 的 runnable composition。
  - 在 staging Helm chart 中增加网络 ACP Service/NetworkPolicy/探针配置。
  - 实现 smoke runner SMOKE-acp-network-01（网络 ACP 端到端 prompt）与 SMOKE-acp-network-02（断连后 `session/resume` 恢复）。

## [deploy] 部署任务
- [x] 在本地 staging 部署网络 ACP server（WebSocket 入口），dspm chat relay 或测试 client 通过 token 连接。
  - 本地协议 smoke：`pnpm -F @deepseek-ai/dsh-acp-network smoke`
  - K8s staging manifests: `deploy/acp-network/k8s/`
- [x] 验证：完整 prompt 闭环、断连 resume、权限确认双向帧。
- [x] 确认 token secret 轮换流程与回滚预案。

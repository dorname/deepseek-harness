## ADDED — ACP-over-network 系统架构

> 变更：20261020-1643-acp-over-network

## 组件表

| 组件 | 包/位置 | 职责 |
|------|---------|------|
| `AcpBridge` | `packages/acp/acp/src/bridge.ts` | 一个 JSON-RPC 连接上的 ACP 语义桥：处理 `initialize`/`authenticate`、session 生命周期、prompt 编排、更新与权限请求投递。 |
| `AcpPlugin` (stdio) | `packages/acp/acp/src/index.ts` | 在进程 stdio 上实例化单个 `AcpBridge`；保留本地/CI 形态。 |
| `AcpNetworkPlugin` | `packages/acp/acp-network/src/index.ts` | 在 Cordis `ctx.webServer` 上注册 WebSocket upgrade route 与 Streamable HTTP route；每个 accepted connection 创建隔离的 `AcpBridge`。 |
| `AcpServer` | `@agentclientprotocol/sdk/experimental/server` | ACP SDK 实验性 server：管理 WebSocket/HTTP 传输、连接注册、initialize 握手。 |
| `dsh-host-webserver` | `packages/host/webserver` | Cordis webserver seam：提供 `registerUpgrade()` / `register()` 接口。 |
| `acp-network-app` bundle | `packages/bundle/acp-network-app` | `dsh --profile acp-network` 启动入口，组合 base + webserver + acp-network。 |
| Token 签发方 | 部署侧/编排器 | 使用共享 secret 签发短期 HMAC token（`sub`/`jti`/`exp`/`aud`）。 |

## 连接时序：首次连接

```text
Client                          dsh-acp-network                AcpServer            AcpBridge
  |                                     |                         |                    |
  |--- WebSocket upgrade /acp --------->|                         |                    |
  |                                     |--- prepareWebSocketUpgrade()               |
  |<-- 101 + Acp-Connection-Id ---------|                         |                    |
  |                                     |--- handleWebSocketConnection()              |
  |                                     |                         |--- connect(stream) |
  |--- initialize -------------------->|                         |                    |
  |                                     |                         |--- initialize()    |
  |<-- initialize response -------------|                         |                    |
  |--- authenticate(token) ------------>|                         |                    |
  |                                     |                         |--- authenticate()  |
  |<-- authenticate response -----------|                         |                    |
  |--- session/new -------------------->|                         |                    |
  |                                     |                         |--- newSession()    |
  |<-- session/new response ------------|                         |                    |
  |--- session/prompt ----------------->|                         |                    |
  |<-- session/update (text chunks) ----|                         |                    |
  |<-- session/prompt response ---------|                         |                    |
```

## 连接时序：断连重连（通过持久化 resume）

```text
Client                          dsh-acp-network                AcpBridge/SessionPersistence
  |                                     |                                  |
  |=== 连接断开 ========================|                                  |
  |                                     |--- AcpBridge.dispose()            |
  |                                     |--- AcpSession.close()             |
  |                                     |--- flush session log               |
  |                                     |                                  |
  |=== 新连接 ==========================|                                  |
  |--- WebSocket upgrade /acp --------->|                                  |
  |--- initialize -------------------->|                                  |
  |--- authenticate(token) ------------>|                                  |
  |--- session/resume {sessionId} ---->|                                  |
  |                                     |--- persistence.stat(sessionId)    |
  |                                     |--- AcpSession.resume()            |
  |<-- session/resume response ---------|                                  |
```

> 当前实现：每个 connection 拥有独立的 `AcpBridge` 实例，connection 关闭会关闭该 bridge 拥有的 session；client 必须通过 `session/close` 显式关闭并持久化会话，或在新连接上通过 `session/resume` 恢复已持久化的会话。后续可增强为 server 级共享 session registry，实现 connection 断开而内存 session 保持。

## 权限确认回环

ACP `session/request_permission` 是 server→client 请求，经 WebSocket 双向帧送达：

```text
AcpBridge ---notify--> clientConn ---transport--> Client
   ^                                              |
   |--------------- response ----------------------|
```

## 安全模型

### 凭证格式

网络形态启用时，`authenticate` 方法校验由部署侧签发的短期 HMAC token：

- 格式：`<base64url-header>.<base64url-payload>.<base64url-signature>`
- Header：`{ alg: "HS256", typ: "JWT" }`
- Payload：`{ sub, jti, exp, aud }`
  - `sub`：token 归属主体，需匹配实例的 `DSH_FLEET_USER_ID`。
  - `jti`：唯一 token id，用于防重放。
  - `exp`：Unix 秒级过期时间。
  - `aud`：受众，需匹配实例受众（默认 `DSH_ACP_NETWORK_AUDIENCE ?? HOSTNAME ?? 'dsh-acp'`）。

### 签发与轮换

- 共享 secret 通过环境变量或 K8s secret 注入 `dsh-acp-network`。
- 部署侧负责签发、轮换 secret；token 有效期默认 5 分钟。
- 进程内只维护短期已用 `jti` 集合，不持久化黑名单。

### 授权边界

- token 仅授权"在此实例上创建/恢复属于该 subject 的 session"。
- `session/list` 受限于同一进程可见的持久化会话；多用户隔离通过"每用户一个 dsh 逻辑实例"保证。
- MCP/工具调用的业务权限由工具层自身凭证进一步约束。

### 防重放

- 每个 token 的 `jti` 在有效期内仅可使用一次。
- 已用 `jti` 集合驻留内存，进程重启后自然清空；依赖 `exp` 限制重放窗口。

### TLS 与网络访问面

- 进程内 webserver 默认监听 loopback（`127.0.0.1`），由 K8s Service/NetworkPolicy 收敛访问面。
- TLS 由 ingress/LoadBalancer 或 Pod 内 sidecar 终结；进程内 WebSocket 为明文。
- 建议通过 NetworkPolicy 限制仅 dspm chat relay 或指定服务可访问 `/acp`。

## 与 ACP SDK 的集成点

- `AcpServer.prepareWebSocketUpgrade()` 在 `101` 响应中附加 `Acp-Connection-Id` header。
- `dsh-host-webserver` 的 `registerUpgrade()` 将 HTTP upgrade 事件路由到插件 handler，避免与 webserver 自身的 `upgrade` 监听冲突。
- HTTP fallback 使用 `createNodeHttpHandler(acpServer)` 并注册到 `ctx.webServer.register({ kind: 'exact', path, handler })`。

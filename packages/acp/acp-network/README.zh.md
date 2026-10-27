---
description: "DeepSeek Harness 的网络 ACP（Agent Client Protocol）传输：在 Cordis webserver 上通过 WebSocket 与 Streamable HTTP 暴露 ACP。"
kind: "package-reference"
---

# @deepseek-ai/dsh-acp-network

[English](README.md) | 中文

## 概述

`dsh-acp-network` 将仅自动化的 ACP 服务器挂载到 Cordis webserver 上，使受信客户端可以通过 WebSocket 或 Streamable HTTP 连接，而非 stdio。每个被接受的连接都会获得一个隔离的 {@link @deepseek-ai/dsh-acp#AcpBridge}，并可创建、提示和关闭自己的会话。认证由可配置的 HMAC token 验证器提供，检查 audience、subject、过期时间与单次使用的 `jti` 声明。运行 `pnpm dsh --profile acp-network` 即可启动网络 ACP 服务器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

当 ACP 客户端需要通过网络访问 harness 时使用本包，例如多用户部署中的每用户 Pod 或远程自动化控制器。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-acp-network'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    transport: websocket
    path: /acp
    secret: '{{env.DSH_ACP_NETWORK_SECRET}}'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | — | 每个会话 agent 的提供方路由 |
| `model` | — | 每个会话 agent 的模型 |
| `transport` | `websocket` | `websocket`、`http` 或 `both` |
| `path` | `/acp` | ACP 端点的绝对路由 |
| `secret` | — | HMAC token 验证的共享密钥 |
| `audience` | `DSH_ACP_NETWORK_AUDIENCE` / `HOSTNAME` / `dsh-acp` | 期望的 token audience (`aud`) |
| `sessionListPageSize` | `100` | 单页 `session/list` 返回的最大摘要数量 |

### Token 格式

客户端使用由共享密钥签名的紧凑 JWT 风格 HMAC token 进行认证：

```
<base64url-header>.<base64url-payload>.<base64url-signature>
```

- Header：`{ alg: "HS256", typ: "JWT" }`
- Payload：`{ sub, jti, exp, aud }`
  - `sub` 必须匹配 `DSH_FLEET_USER_ID`
  - `aud` 必须匹配配置的 `audience`（默认 `dsh-acp`）
  - `jti` 在 token 生命周期内必须唯一
  - `exp` 为 Unix 秒级过期时间，建议 ≤ 300

### 运行本地 smoke

```sh
pnpm -F @deepseek-ai/dsh-acp-network smoke
```

该命令在进程内启动服务器并 mock LLM，验证 WebSocket 握手、token 认证、prompt 闭环以及断连后 `session/resume` 恢复。

### 启动服务器

`pnpm dsh --profile acp-network` 会启动随附的网络 ACP 服务器。TLS 应由 ingress、负载均衡器或 sidecar 终结；进程内 webserver 默认监听 loopback。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：token 验证器、WebSocket upgrade 与 HTTP 路由注册、每连接 `AcpBridge` |

本插件使用 `@agentclientprotocol/sdk/experimental/server`（`AcpServer`）进行传输帧处理。WebSocket 路径在 HTTP upgrade 之前调用 `AcpServer.prepareWebSocketUpgrade()`，以便附加 `Acp-Connection-Id` header。HTTP 路径使用 `createNodeHttpHandler`。每个被接受的连接都会获得一个注入 `authenticate` 钩子的新鲜 `AcpBridge`。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包仅传输 ACP 帧与认证元数据，不贡献模型上下文。

#### KV Cache 影响

无；传输层对模型而言是无状态的。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **会话绑定到连接** — 每个 `AcpBridge` 拥有自己的会话；连接关闭时其会话也会被关闭。断连后恢复需要会话已被显式关闭并持久化，然后通过 `session/resume` 恢复。未来的服务端共享会话注册表可使会话在重连间保持活跃。
- **token 重放存储在内存中** — 已用 `jti` 值仅在进程生命周期内保留；token 有效期限制了重放窗口。
- **TLS 终结在外部** — 本插件提供明文 WebSocket/HTTP；请在 ingress、负载均衡器或 sidecar 处加密。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

---
description: "User Fleet 部署的 OIDC 认证反向代理：每个浏览器一份网关会话、严格按主体路由到所属用户进程、启动令牌不出回环。"
kind: "package-library"
---

# @deepseek-ai/dsh-gateway

[English](README.md) | 中文

## 概述

通过 OIDC 认证浏览器用户，并将每个请求路由到该用户的独立 Web 进程。签名的 HttpOnly cookie 将请求绑定到认证主体；启动令牌和上游 cookie 留在回环内。fleet manager 负责进程启动和容量限制。网关应部署在 TLS 终结器之后，并配置身份提供方回调所需的公开 URL。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 fleet manager 之前部署一个网关。`homesDir` 指向与 manager 相同的 homes 根目录，并配置身份提供方绑定：

| 字段 | 含义 | 默认值 |
|---|---|---|
| `homesDir` | Fleet homes 根目录（须与 fleet manager 一致） | 必填 |
| `oidc` | 在提供方注册的 `{ issuer, clientId, clientSecret }` | 必填 |
| `host` / `port` | 绑定地址；端口 `0` 由操作系统分配 | 回环 / `0` |
| `publicUrl` | 浏览器使用的外部规范根地址；用于构造 OIDC `redirect_uri` | 绑定地址 |
| `sessionTtlMs` | 网关会话寿命 | 12 小时 |
| `sessionSecret` | 32 字节 base64url cookie 签名密钥 | 每进程随机生成 |

```ts
import { FleetGateway } from '@deepseek-ai/dsh-gateway'
import { FleetManager } from '@deepseek-ai/dsh-fleet-manager'

const fleetManager = new FleetManager({ homesDir: '/data/homes' })

const gateway = new FleetGateway(
  { homesDir: '/data/homes', oidc: { issuer: 'https://idp.example', clientId: '...', clientSecret: '...' } },
  { fleetManager },
)
const { port } = await gateway.start()
await gateway.dispose()
await fleetManager.dispose()
```

配置错误在解析时即响亮失败：缺失 homes 根、issuer、客户端绑定或畸形密钥都会拒绝启动。端口由操作系统分配且未显式配置 `publicUrl` 时，重定向目标会重新钉到实际绑定端口，保证提供方的回调能到达本网关。超过十分钟的登录尝试会随其 CSRF state 一并丢弃；被拒绝或失败的兑换以 401 附带明确原因作答，不开启会话。fleet manager 报告部署满载时，浏览器收到 503 而不是排队。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计说明

- **路由从头到尾绑定主体。** `handle` 校验网关会话，请求 manager 确保该主体的进程，然后代理到 manager 报告的端口。主体从不经过 URL 路径或查询参数，因此引用其他用户会话 id 的 URL 仍会落入请求者自己的进程。
- **cookie jar 留在回环。** 每个进程宣告一个启动令牌 URL；网关在 `127.0.0.1` 上 GET 它，按主体存下铸造的浏览器会话 cookie，并在代理请求时回放。进程拒绝 jar 时（携带新密钥的重启）触发一次重新兑换——仅限 GET/HEAD，其重放不会破坏上传的请求体。
- **响应过滤。** 被代理的响应丢弃 `Set-Cookie` 与逐跳头，进程内部 cookie 与网关会话 cookie 互不混杂。
- **升级走同一道栅栏。** WebSocket 握手要求网关会话加已入账的 jar，原样转发 `Upgrade`/`Connection`（它们就是握手本身），重写 `Host`/cookie/转发头，并对原始套接字做双向管道。其余情况——无会话、无 jar、容量拒绝、上游死亡——一律销毁。
- **发现与兑换藏在接缝后。** OIDC 发现、授权重定向、授权码换主体的兑换都通过注入的 `fetch` 运行，并检查 ID token 的 issuer、audience、expiry 声明；签名本身由到 token 端点的直连 TLS 通道验证（OIDC Core 3.1.3.7）。

| 文件 | 职责 |
|---|---|
| [`src/config.ts`](src/config.ts) | 部署字段、默认值、响亮失败的校验 |
| [`src/oidc.ts`](src/oidc.ts) | 发现、授权重定向、授权码换主体兑换 |
| [`src/session.ts`](src/session.ts) | 签名、带过期的网关会话 cookie |
| [`src/gateway.ts`](src/gateway.ts) | HTTP 服务器：登录流程、按主体代理、启动令牌 jar、升级路由 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 认证路由

#### 模型看到什么

无直接影响。`FleetGateway` 负责宿主侧路由，不改变模型请求。

#### Token 影响

不增加请求 token。

#### KV Cache 影响

无；请求前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **最小 OIDC 客户端。** 本流程实现了带直连 token 端点声明检查的授权码授予，而非通用 OIDC 依赖方：无 JWKS 签名校验、无刷新令牌、无反向通道登出。
- **单主机、单网关进程。** 随机生成的会话密钥使网关会话不跨重启存活；需要粘性会话的部署应显式配置 `sessionSecret`。
- **TLS 在上游终结。** 网关使用纯 HTTP，应部署在部署方 TLS 终结器之后；`publicUrl` 必须是外部可见根地址。
- **本地信任模型。** 网关与用户进程之间的回环按构造可信；主机的管理员用户可以直接触达每个进程。
- **Windows 未测试。** 本套件会派生真实子进程，与 fleet manager 一同排除在 Windows 车道之外。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

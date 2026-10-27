---
description: "dsh ACP-over-network profile bundle：通过 `dsh --profile acp-network` 启动网络 ACP 服务器。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-acp-network-app

[English](README.md) | 中文

## 概述

`dsh-acp-network-app` 是可运行的 profile bundle，使用 `dsh --profile acp-network` 启动 ACP-over-network 服务器。它在 `dsh-base` 与 Cordis webserver 之上叠加网络 ACP 传输。当远程或 Pod 内客户端需要通过 WebSocket 或 Streamable HTTP 驱动 DeepSeek Harness agent 时使用它。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

`pnpm dsh --profile acp-network` 可启动服务器。通过 profile 的 `cordis.patch.yml` 中的 `acp-network` 插件或环境变量配置传输：

| 变量 | 含义 |
|---|---|
| `DSH_ACP_NETWORK_SECRET` | 用于验证 HMAC token 的共享密钥 |
| `DSH_FLEET_USER_ID` | 期望的 token subject (`sub`) |
| `DSH_ACP_NETWORK_AUDIENCE` | 期望的 token audience (`aud`)，默认 `dsh-acp` |

-----

<a id="model-experience"></a>
## 模型体验

无，因为本 bundle 仅挂载网络传输，并将每个模型面向的效果委托给底层 ACP bridge。

#### KV Cache 影响

无；ACP bridge 拥有每个模型面向的字节。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **会话绑定到连接** — 会话归属于每连接的 `AcpBridge`；断连会关闭会话。重连后恢复需要显式 `session/close` 与 `session/resume`。
- **token 重放存储在内存中** — 已用 `jti` 值仅在进程内存中跟踪。
- **无内置 TLS** — 请在 ingress 或 sidecar 处终结 TLS。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

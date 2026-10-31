---
description: "dsh cluster-web runner profile bundle: dispatch-runner replicas with Postgres session leases and the auto-starting agent dispatch loop, via `dsh --profile cluster-web-runner`."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cluster-web-runner-app

[English](README.md) | 中文

## 概述

`dsh-cluster-web-runner-app` 是 `dsh --profile cluster-web-runner` 背后的组合 bundle。它叠在 `dsh-cluster-web-app` 之上,补上 runner 副本在 API 组合之外所需的部分:Postgres 会话租约,以及 `runner: true` 的 `agent-dispatch`,使派发循环在挂载即启动、认领排队会话并驱动执行。启动这些副本的拓扑见 [deploy/cluster-web](../../../deploy/cluster-web/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh --profile cluster-web-runner --no-open --host 127.0.0.1 --port <端口>` 启动一个 runner 副本。派发循环需要租约身份;`DSH_NODE_ID` 未设置时挂载在 `agent-dispatch` 内部失败。

| 变量 | 含义 |
|---|---|
| `DATABASE_URL` | 必填,共享会话数据库的 `postgres://` 连接串 |
| `DSH_NODE_ID` | 必填,本 runner 的租约身份(例如 `runner-1`);存活 runner 之间必须唯一 |

-----

<a id="model-experience"></a>
## Model Experience

无。本 bundle 只增加编排行;所有模型可见效果由下层持有。

#### KV Cache effect

无;派发与租约只调度工作,不改变模型请求的内容。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **租约之外无跨 runner 互斥** —— 两个 runner 使用同一 `DSH_NODE_ID` 会互相拆租约;唯一性由启动方负责。
- **轮询回退保持 250 ms** —— `pollMs` 与验收拓扑一致;需要调整时由更后的 profile 层 patch `agent-dispatch` 行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

`runner: true` 使派发循环在挂载即启动;循环从同一行读取 `nodeId`,缺失时拒绝挂载。bundle 化之前的 `runner.overlay.yml` 只传了 `nodeId`,而当前 `agent-dispatch` schema 忽略该键——本 bundle 移植的是插件当前契约,不是那份过期 overlay。

</details>

---
description: "无状态 webhook 入口：签名校验后事件入共享库队列，恰一消费创建 Workspace Session。"
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-ingress

[English](README.md) | 中文

## 摘要

`dsh-webhook-ingress` 是集群部署的无状态 webhook 入口：入口副本校验 HMAC-SHA256 签名后把事件写入共享 `webhook_events` 表（去重键为主键,副本复制与发送方重试折叠为一行）并 `NOTIFY` 唤醒,随即响应受理。消费循环以 `FOR UPDATE SKIP LOCKED` 取 pending 事件、经注入的 consume 回调创建 Workspace Session、并在同一事务内标记完成——崩溃回滚取用、下一轮重建,事件不丢、会话不重复。所建会话的 id 进入执行池队列；入口/消费/执行三段独立伸缩。本包只在宿主侧。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="使用本包"></a>
## 使用本包

入口副本在 HTTP 路由后挂 `enqueue`；消费节点挂 `runConsumer`：

```yaml
plugins:
  '@deepseek-ai/dsh-webhook-ingress':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_webhook
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `connectionString` | 必填 | 共享事件库的 `postgres://` 连接串 |
| `max` | `2` | 连接池大小 |
| `pollMs` | `250` | 等待 pending 事件时的轮询兜底间隔 |
| `consume` | 必填 | 消费回调：创建 Workspace Session 并把其 id 交给执行池 |

### 可观察行为

全新数据库在一个事务内盖物理布局版本戳；其他已戳版本拒绝——不迁移，预发布立场。每事件至少消费一次：抛错回滚取用、下一轮重建,会话创建须按去重键幂等。

-----

<a id="模型体验"></a>
## 模型体验

### 集群 webhook 入口

#### 模型看到什么

无。本包不贡献 prompt、工具或 schema；仅为宿主侧消费方在 Cordis 服务之后排队外部事件。

#### Token 影响

零 live-request token。

#### KV Cache 影响

无——本包从不触碰活请求前缀。

## 已知限制与待办

- **预发布物理布局**——任何外部戳记的布局版本拒绝而非迁移。
- **至少一次消费**——建会话与提交之间的崩溃可能重消费一个事件；会话创建须按去重键幂等。
- **数据库与 schema 必须预先存在**——提供方建表不建库；连接或权限故障在首次使用时浮出。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

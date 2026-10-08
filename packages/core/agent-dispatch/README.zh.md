---
description: "派发队列与 runner 编排：投递会话 id、取租约、从共享 inbox 接续、丢租约即取消。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-dispatch

[English](README.md) | 中文

## 摘要

`dsh-agent-dispatch` 是执行池的派发队列加 runner 编排循环。入口面把会话 id 投递到共享表（`INSERT … ON CONFLICT DO NOTHING`，同一会话至多一行）；runner 节点取走一条、取得其会话租约、从共享持久层恢复会话（durable inbox 投影驱动接续）、`waitLost` 一 settle 即取消 agent、空闲即释放。`agent-loop` 零感知租约。本包只在宿主侧：不贡献 prompt、工具或 schema，模型与 agent 循环完全不可见。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="使用本包"></a>
## 使用本包

runner 节点与会话租约提供方、持久化后端一并挂载本循环：

```yaml
plugins:
  '@deepseek-ai/dsh-agent-dispatch':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_dispatch
    nodeId: runner-a
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `connectionString` | 必填 | 共享派发库的 `postgres://` 连接串 |
| `max` | `2` | 连接池大小 |
| `nodeId` | 无（循环必需） | 本 runner 的租约身份 |
| `leaseTtlMs` | `2000` | 租约有效期；心跳间隔由其派生 |
| `pollMs` | `250` | 等待队列工作时的轮询兜底间隔 |
| `idleGraceMs` | `5000` | 空闲 agent 释放租约前的宽限 |

### 可观察行为

全新数据库在一个事务内盖物理布局版本戳；其他已戳版本拒绝——不迁移，预发布立场。租约始终不可得时会话停回重试轮询，绝不并发执行；租约丢失即取消 agent 并释放行，会话可重新入队。

-----

<a id="模型体验"></a>
## 模型体验

### 执行池派发

#### 模型看到什么

无。本包不贡献 prompt、工具或 schema；仅为宿主侧消费方在 Cordis 服务之后编排会话执行。

#### Token 影响

零 live-request token。

#### KV Cache 影响

无——本包从不触碰活请求前缀。

## 已知限制与待办

- **预发布物理布局**——任何外部戳记的布局版本拒绝而非迁移。
- **队列为部署级、不按用户命名空间**——会话到达派发时已携其 fleet 主体；表即普通 `session_id` 队列。
- **数据库与 schema 必须预先存在**——提供方建表不建库；连接或权限故障在首次使用时浮出。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

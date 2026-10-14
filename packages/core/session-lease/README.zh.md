---
description: "Service Definition：单会话跨节点单写者认领——acquire/renew/release/ownerOf/waitLost。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-lease

[English](README.md) | 中文

## 概述

通过原子获取、续约和释放租约，在 runner 节点间协调单个会话写入方。消费方观察租约丢失，并在所有权到期时取消工作。挂载 `session-lease-postgres` 等提供方以实现共享存储。抽象服务不添加模型输入。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

消费方使用 `ctx.sessionLease`。挂载 [PostgreSQL 提供方](../session-lease-postgres/README.zh.md)注册具体实现；抽象服务本身不连接数据库。

### 可观察行为

空闲或到期租约可被原子获取；仍由其他节点持有的有效租约返回持有者和到期时间。仅所有者可续约或释放。`waitLost` 在所有权丢失时完成，并接受取消。

-----

<a id="model-experience"></a>
## 模型体验

### 跨节点会话执行

#### 模型看到什么

无直接影响。`ctx.sessionLease` 协调宿主侧会话工作，不添加提示、工具或 schema。

#### Token 影响

零 live-request token。

#### KV Cache 影响

无——本包从不触碰活请求前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **必须有提供方** — 本包声明服务，不实现存储。
- **无保留 API** — 清理由提供方或部署负责。
- **仅宿主侧协调** — 调用方负责会话执行、持久日志和浏览器交付。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

---
description: "Service Definition：按单调序号中继单会话的事件与 assistant-stream 帧。"
kind: "package-reference"
---

# @deepseek-ai/dsh-stream-relay

[English](README.md) | 中文

## 概述

发布已有会话事件和 assistant-stream 帧，供其他副本重放。各会话序号递增；订阅方先从游标重放，再接收新记录。挂载 `stream-relay-postgres` 等提供方以实现共享传输。转发服务不添加模型输入。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

消费方使用 `ctx.streamRelay`。挂载 [PostgreSQL 提供方](../stream-relay-postgres/README.zh.md)注册具体实现；抽象服务本身不连接数据库。

### 可观察行为

`publish` 分配下一个会话序号。`read` 返回游标之后的记录；`subscribe` 先重放已有记录，再交付实时记录，并接受取消。负载保持原样。

-----

<a id="model-experience"></a>
## 模型体验

### 跨节点会话执行

#### 模型看到什么

无直接影响。`ctx.streamRelay` 协调宿主侧会话工作，不添加提示、工具或 schema。

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

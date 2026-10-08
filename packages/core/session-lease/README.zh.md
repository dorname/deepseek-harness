---
description: "Service Definition：单会话跨节点单写者认领——acquire/renew/release/ownerOf/waitLost。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-lease

[English](README.md) | 中文

## 摘要

Service Definition：单会话跨节点单写者认领——acquire/renew/release/ownerOf/waitLost。 本包只在宿主侧：不贡献 prompt、工具或 schema，模型与 agent 循环完全不可见。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="使用本包"></a>
## 使用本包

在 profile 的 `cordis.yml` 中与执行池部署的其余部分一同加载（持久日志用 `session-persistence-postgres`）；runner 节点挂租约与派发，Web/API 副本挂中继订阅。

### 可观察行为

全新共享库在一个事务内盖物理布局版本戳；其他已戳版本拒绝——不迁移，预发布立场。租约获取/续约/释放与中继发布/读取在介质故障时响亮拒绝；`waitLost` 与中继订阅随其 signal 干净 settle 或取消。

-----

<a id="模型体验"></a>
## 模型体验

### 跨节点会话执行

#### 模型看到什么

无。本包不贡献 prompt、工具或 schema；仅为宿主侧消费方在 Cordis 服务之后仲裁或传输会话状态。

#### Token 影响

零 live-request token。

#### KV Cache 影响

无——本包从不触碰活请求前缀。

## 已知限制与待办

- **预发布物理布局**——任何外部戳记的布局版本拒绝而非迁移。
- **提供方本地语义**——本包不拥有保留或清理；共享表持续累积直至外部删除。
- **数据库与 schema 必须预先存在**——提供方建表不建库；连接或权限故障在首次使用时浮出。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

---
description: "PostgreSQL 附件后端：共享库内按 fleet 主体命名空间隔离的内容寻址图像对象。"
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-postgres

[English](README.md) | 中文

## 摘要

`dsh-attachment-postgres` 是一个附件后端:每个获准图像作为一条不可变内容寻址行(`(namespace, sha256)` 主键)存入共享 PostgreSQL 库,注册为 `ctx.attachments`。多个 dsh 节点可指向同一数据库,经 `DSH_FLEET_USER_ID` 注入的 fleet 主体派生 namespace 列,不同主体的节点互相够不到对方对象。这是缝允许的最小共享介质实现:图像校验与持久图像引用;逐字文件与请求投影保持缝的默认拒绝。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [延伸阅读](#延伸阅读)
- [模型体验](#模型体验)
- [已知限制与待办](#已知限制与待办)

-----

<a id="使用本包"></a>
## 使用本包

在 profile 的 `cordis.yml` 中加载本后端(仅宿主侧;模型不可见):

```yaml
plugins:
  '@deepseek-ai/dsh-attachment-postgres':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_attachments
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `connectionString` | 必填 | 共享附件库的 `postgres://` 连接串 |
| `max` | `4` | 连接池大小 |
| `maxImageBytes` | `20971520` | 单图最大编码字节数 |
| `maxImagesPerMessage` | `20` | 单条消息最大图像数 |
| `maxMessageImageBytes` | `52428800` | 单条消息图像批次最大聚合字节数 |
| `maxImagePixels` | `100000000` | 单图最大解码像素数 |
| `maxImageDimension` | `30000` | 单图最大内禀宽/高像素数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-attachment-postgres)是每个接受字段及其 JSDoc 的穷尽来源。

### 可观察行为

全新数据库在一个事务内盖物理布局版本戳;其他已戳版本拒绝——不迁移,预发布立场。图像在获准时完整解码(Sharp):超限、超像素或非法字节以缝的稳定 `AttachmentError` 码拒绝且不落任何对象。读取时对存储字节重算 sha256 与引用比对,未知或跨命名空间引用以 `ATTACHMENT_NOT_FOUND` 失败。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计概念

- **内容寻址不可变行。** 每 `(namespace, sha256)` 一行;在另一命名空间重存相同字节会写第二行而非链接,命名空间永不互混。
- **获准解码,读取校验。** `saveImage`/`validateImage` 完整解码光栅(限制作用于解码事实);`readImage` 重算摘要并比对,镜像本地后端的读时校验。
- **命名空间源自注入的 fleet 主体。** 与存储枢纽域命名空间同一条摘要规则(`u` + 主体的 16 位十六进制 sha256);未注入时存于默认空命名空间。
- **连接生命周期为单一 effect。** 池惰性打开(故障在首次使用浮出),经单一上下文 effect 关闭。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口:`AttachmentStore` 服务——获准、内容寻址保存、校验读取 |
| [`src/schema.ts`](src/schema.ts) | 连接序列、物理布局版本、对象表 |
| [`src/sharp.ts`](src/sharp.ts) | Sharp 懒加载,与本地后端同法 |

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [附件子系统](../../../docs/subsystems/attachment.zh.md)——存储契约、获准语义与请求投影。
- [Attachment 包地图](../README.zh.md)——该家族的包及其仓库位置。
- [本地附件后端](../attachment-local/README.zh.md)——单机构成的文件系统介质。

-----

<a id="模型体验"></a>
## 模型体验

### 存储的附件对象

#### 模型看到什么

无。本后端不贡献 prompt、工具或 schema;仅为宿主侧消费方在 `ctx.attachments` 之后存储二进制附件。

#### Token 影响

零 live-request token。

#### KV Cache 影响

无——本后端从不触碰活请求前缀。

## 已知限制与待办

这些限制界定本后端何时不适用或需要特殊运维关注。它们是当前包约束,不是任务清单。

- **逐字文件与请求投影保持缝的默认拒绝**——`saveFile`/`saveFileStream`/`readFileStream`/`readImageRequest` 以 `ATTACHMENT_FILES_UNSUPPORTED`/`ATTACHMENT_PROJECTION_UNSUPPORTED` 拒绝;共享介质变更只覆盖图像存储。
- **无规范化**——图像按获准字节原样存储;本地后端的方向与缩放规范化暂无 PostgreSQL 对应。
- **无保留策略**——对象持续累积直至外部删除;缝没有删除 API。
- **数据库与 schema 必须预先存在**——后端建表不建库;连接或权限故障在首次使用时浮出。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

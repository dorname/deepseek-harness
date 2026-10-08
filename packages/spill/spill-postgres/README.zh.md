---
description: "PostgreSQL 溢出后端：超限工具结果文本以不透明引用持久化到共享库。"
kind: "package-reference"
---

# @deepseek-ai/dsh-spill-postgres

[English](README.md) | 中文

## 摘要

`dsh-spill-postgres` 是一个溢出后端:每条溢出文本作为一行存入共享 `spill_texts` 表,以后端自造的不透明引用为键,注册为 `ctx.spillStore`。多个 dsh 节点可指向同一数据库,经 `DSH_FLEET_USER_ID` 注入的 fleet 主体派生 namespace 列,不同主体的节点互相看不到对方的溢出。缝保持刻意最小:只有 `saveText`——保留、替换与检索归各自的包负责。

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
  '@deepseek-ai/dsh-spill-postgres':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_spill
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `connectionString` | 必填 | 共享溢出库的 `postgres://` 连接串 |
| `max` | `2` | 连接池大小 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-spill-postgres)是每个接受字段及其 JSDoc 的穷尽来源。

### 可观察行为

全新数据库在一个事务内盖物理布局版本戳;其他已戳版本拒绝——不迁移,预发布立场。`saveText` 按属主会话作用域逐字保存完整内容,返回带 `pgspill_` 前缀的不透明引用、精确字节长度与面向模型的取回指引;存储故障响亮拒绝,由调用方决定降级。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计概念

- **不透明引用,不含存储坐标。** locator 是随机自造的 `pgspill_<hex>` 串;消费方从不解析,它不指名任何表或行。
- **命名空间源自注入的 fleet 主体。** 与存储枢纽域命名空间同一条摘要规则(`u` + 主体的 16 位十六进制 sha256);未注入时存于默认空命名空间。
- **单一缝方法。** `saveText` 即全部后端;Service Definition 不拥有保留、替换或检索词汇。
- **连接生命周期为单一 effect。** 池惰性打开(故障在首次使用浮出),经单一上下文 effect 关闭。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口:`SpillStore` 服务——布局确保与 `saveText` |

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [Spill 包地图](../README.zh.md)——该家族的包及其仓库位置。
- [本地溢出后端](../spill-local/README.zh.md)——单机构成的文件系统介质。

-----

<a id="模型体验"></a>
## 模型体验

### 溢出的工具结果文本

#### 模型看到什么

本后端引用在溢出结果占位符内携带的 locator 与取回指引;请求中的其他内容不变。

#### Token 影响

零 live-request token——溢出替换的是超限内联文本,从不增加。

#### KV Cache 影响

无——本后端从不触碰活请求前缀。

## 已知限制与待办

这些限制界定本后端何时不适用或需要特殊运维关注。它们是当前包约束,不是任务清单。

- **无读取 API**——缝只暴露 `saveText`;检索是运维方按引用对共享介质的操作。
- **无保留策略**——溢出持续累积直至外部删除;保留由归属的保留包治理。
- **数据库与 schema 必须预先存在**——后端建表不建库;连接或权限故障在首次使用时浮出。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

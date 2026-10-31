---
description: "dsh cluster-web API profile bundle: same-origin API replicas without the SPA, on shared Postgres persistence, via `dsh --profile cluster-web-api`."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cluster-web-app

[English](README.md) | 中文

## 概述

`dsh-cluster-web-app` 是 `dsh --profile cluster-web-api` 背后的组合 bundle。它叠在 `dsh-web-app` 之上,把一个 dsh 进程变成 cluster-web API 副本:SPA 回退保持关闭(由同源 shell 或 edge 服务前端),本地 JSONL 持久化替换为共享 Postgres 会话持久化与流转发,同一 origin 后的所有副本共享会话状态。启动这些副本的拓扑见 [deploy/cluster-web](../../../deploy/cluster-web/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh --profile cluster-web-api --no-open --host 127.0.0.1 --port <端口>` 在同源 edge 之后启动一个 API 副本。Postgres 行从环境读取连接串;未设置时启动在插件校验处失败,而不是回落到本地持久化。

| 变量 | 含义 |
|---|---|
| `DATABASE_URL` | 必填,共享会话数据库的 `postgres://` 连接串 |

-----

<a id="model-experience"></a>
## Model Experience

无。本 bundle 只替换持久化与前端服务方式;所有模型可见效果由下层持有。

#### KV Cache effect

无;持久化替换改变会话字节的落点,不改变模型请求的内容。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **单一共享数据库** —— 所有副本读取同一个 `DATABASE_URL`;本 bundle 不提供按副本分库的组合。
- **连接池固定为 2** —— Postgres 池 `max` 与验收拓扑一致;部署规模超出时,由更后的 profile 层 patch 插入行调大。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

`web-runtime` 覆盖重述了 `dsh-web-app` 行持有的全部键,因为 patch 替换目标行的整段 `config`;在这里丢键会让每个 API 副本静默失去运行时粘合。

</details>

---
description: "Fleet 包组：自托管多用户部署的独立用户进程生命周期和认证路由。"
kind: "package-group"
---

# fleet/ — User Fleet 部署组件

[English](README.md) | 中文

## 概述

Fleet 包组提供自托管多用户部署的两个组件：fleet manager 为登录用户管理独立的 dsh Web 进程及 `$DSH_HOME`；网关认证用户，将请求路由到对应用户的进程。它们是部署类库；单用户 `dsh web` 部署无需使用。本页列出包，各包 README 负责详细说明。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`fleet-manager`](fleet-manager/README.zh.md) | 为每个用户启动、回收、重启并限制 dsh Web 进程，各进程使用独立 `$DSH_HOME` |
| [`gateway`](gateway/README.zh.md) | 通过 OIDC 认证用户，将每个请求路由到其进程并拒绝跨用户访问 |

<a id="related-documentation"></a>
## 相关文档

- [公开部署指南](../../docs/user/guide/public-deployments.zh.md) — 网关所用的单用户反向代理路径。
- [dsh-home-paths](../util/home-paths/README.zh.md) — `$DSH_HOME` 解析及用户隔离目录。
- [dsh-anonymous-user-id](../identity/anonymous-user-id/README.zh.md) — 携带 fleet 注入主体的审计归属。

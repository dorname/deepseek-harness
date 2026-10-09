# 变更提案：stateless-cluster-deployment（无状态集群部署形态）

> module: core | created: 2026-10-09

## 变更原因

多用户与集群落地方案（`logos/resources/reference/note/2026-10-06-multi-user-and-cluster-plan.md`）M0–M4 全部交付后，用户确认目标部署形态为：**单租户、无状态后端集群、编排器无关**——K8s 是支持的编排器之一（compose/systemd/裸机多进程同等），不是依赖。当前最后一块缺口是进程生命周期胶水：`drain()` 已交付为方法，但部署形态需要「进程加载即起循环、收到 SIGTERM（一切编排器的通用停止信号）即 drain 后退出」的自动接线；同时编排器无关部署原则（K8s/compose/systemd 支持矩阵、单租户命名空间语义、前端反代指引）需要落到部署文档。另经组合验证确认：用户层 patch 可禁用/覆盖/插入插件行（`disabled` + `insert` 段），集群副本与 runner 形态已可在不改源码的前提下经配置组装。

## 变更类型

设计级（生命周期胶水 + 部署文档；无新场景，S43 修订扩展）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（S42 详述扩展：编排器无关退出语义；5.3 不做清单补一条——不做编排器专属集成）
- 影响的功能规格：`core-01-feature-design.md`（S42 交互规格补编排器无关节）
- 影响的业务场景：S42（排空语义扩展到「SIGTERM = 任意编排器的排空指令」）
- 影响的部署方案：`core-01-deployment-plan.md`（MODIFIED 部署拓扑/环境变量：编排器无关支持矩阵、单租户声明、前端反代指引、runner 配置化启动）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（追加 SMOKE-core-19：SIGTERM 优雅排空）

## 部署影响

- 是否需要部署：是
- 部署原因：SMOKE-core-19 需要「真实进程收到 SIGTERM 后优雅排空退出」的进程级事实——本地以双 runner 进程 + 信号注入验证
- 影响环境：本地 staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：否（纯胶水；关闭即回退到显式调用形态）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

本次变更为无状态集群部署形态收口，三件胶水 + 一份部署文档：

1. **agent-dispatch runner 生命周期**：`nodeId` 配置在场即加载自动起派发循环（AbortController 挂 fiber），fiber dispose（SIGTERM 已由 launcher 接线）→ `drain()` 等待 in-flight drive 到 turn 边界 → 关池。编排器只管「起进程 / 发 SIGTERM」。
2. **schedule-dispatch / webhook-ingress 循环生命周期**：`loop: true` / `consumer: true` 配置在场同理——加载起循环、dispose 排空退出。
3. **编排器无关部署文档**：部署方案新增支持矩阵（K8s / docker compose / systemd / 裸机多进程），单租户命名空间语义声明（不注入 `DSH_FLEET_USER_ID` 即全集群默认命名空间），前端独立部署走同域反代指引（`--public-url`/`--trusted-host` 既有路径）。

范围裁剪：多租户命名空间迁移（subject 从进程 env 迁到请求身份）明确不做——单租户形态下进程级默认命名空间即正确语义，多租户需求出现时另行立项；K8s 专属集成（Operator/CRD）不做——编排器无关原则排除。

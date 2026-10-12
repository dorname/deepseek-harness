# 变更提案：cluster-web-dsh-up（同域集群 `dsh up` 一键 · P1）

> module: core | created: 2026-10-12

## 变更原因

P0（`cluster-web-compose`，已归档）交付了 `deploy/cluster-web` 进程树与 Compose。用户仍需记住 Node 入口路径。本变更把同一拓扑接到 `dsh up` 启动器子命令（与 `dsh plugin` 同级，非新 profile），无 Docker 亦可一键；验收继续强制低副本与 CPU 阈值。

## 变更类型

设计级 + 代码级（CLI 子命令 + SMOKE-core-21；场景 S44）

## 变更范围

- 影响的需求文档：`core-01-requirements.md`（S44）
- 影响的功能规格：`core-01-feature-design.md`（S44）
- 影响的业务场景：S44
- 影响的部署方案：`core-01-deployment-plan.md`（`dsh up` 入口）
- 影响的入口点：`core-entry-points.md`（可选）
- 影响的 API / DB：无
- 影响的编排测试：`core-S44-test-cases.md`
- 影响的 smoke：SMOKE-core-21

## 部署影响

- 是否需要部署：是（SMOKE-core-21 拉起进程树）
- 影响环境：本地 staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

1. **`dsh up`**：启动器子命令，转发到 `deploy/cluster-web/supervise.mts`；支持 `--edge-port`、`--api-replicas`、`--runner-replicas`（硬上限 2）、`--public-url`、`--trusted-host`、`--skip-overlays`、`--skip-runners`。
2. **验收**：默认 1/0 副本；串行；CPU ≤ `cpuThresholdPercent`（SMOKE-core-21）。
3. **不做**：不改默认 `web` profile；不做 Helm（P2）。

## 验收资源约束

与 S43 相同：smoke 默认 API=1、RUNNER=0；硬上限 2；串行；CPU 阈值门禁。

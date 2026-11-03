# 变更提案：按供应商 baseURL 动态发现 DeepSeek 模型目录

> module: core | created: 2026-11-03

## 变更原因

dspm 真实联调中，静态目录发布的 `deepseek-official/deepseek-flash` 被上游以 `unknown model` 拒绝，而供应商实际发布的模型 ID 包含 `deepseek-v4-flash`。当前 DeepSeek API-key 路由只发布配置或内置静态模型，ACP 还会把目录错误吞成空组并补回当前模型，导致目录、可选值与真实上游能力不一致。

本变更来源于已审核的 `REQ-dsh-provider-model-discovery` 与 `DES-dsh-provider-model-discovery` 交接基线，要求在 dsh 内原生完成动态模型发现，而不是由 dspm 预写另一份静态清单。本提案是交接基线要求的 dsh 仓重新立项与审核入口；原任务中的 dsh 只读约束不被解释为既有实施授权，代码实施仍以本提案后续 plan 与 slice 人工批准门为前置。

## 变更类型

需求级

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的场景总览与 P0 场景详述；新增 S48，并关联 S03、S20、S26。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 的 SDK / ACP 结构与 P0 场景交互规格。
- 影响的业务场景：新增 S48「按供应商 baseURL 动态发现 DeepSeek 模型目录」；回归既有 S03 ACP 会话、S20 供应商配置、S26 会话恢复。
- 影响的技术架构：`core-system-map.md`、`acp-network-system-map.md`、`acp-S01-network-session-lifecycle.md` 与新增 `core-S48-provider-model-discovery.md`。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 的凭据、发布、配置迁移、回滚和部署后检查。
- 影响的 API：不新增 ACP 方法或字段；调整 `llm.listModels` 的目录来源与取消语义，以及 ACP `session/new`、`session/set_config_option` 的目录和错误行为。
- 影响的 DB 表：无；会话继续保存既有 `provider/model` 字符串。
- 影响的编排测试：无；core 模块已跳过 API 编排层。
- 影响的测试规格：新增 `logos/resources/test/core-S48-test-cases.md`；更新 `logos/resources/test/smoke/core-smoke-test-cases.md`；复用 S03、S20、S26 既有回归用例。
- 实现期交付物：受影响包的中英文 README 与 JSDoc、keyless ACP 快照，以及 `docs/upgrade-guide/v0.2.1-alpha.1/deepseek-dynamic-model-discovery/` 的中英文升级指南和配对记录；说明动态发现、人工 `models` 覆盖、失败传播与旧离线目录迁移。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费包含动态发现实现的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物，不通过 dspm 静态模型清单伪装回滚。
- 是否需要 smoke：是
- smoke 要求：必须使用真实供应商目录与既有 Secret 验证精确模型 ID 的推理，并如实记录第二个模型的结果或权限失败。

## 变更概述

为 DeepSeek API-key 路由新增按解析后 `baseURL`、Anthropic Messages 协议和现有凭据进行模型目录发现的能力。默认目录只来自上游真实响应；显式 `models` 保留为可见的人工覆盖模式，发现失败、空目录、畸形响应或凭据问题均不得回退到内置静态项。实现包含有限超时、调用方取消、响应大小上限、按配置与凭据代际隔离的短时成功缓存，以及保留等待者独立取消的并发请求合并。

ACP 使用同一份动态目录构建和校验 `configOptions`：目录错误显式传播，成功空目录保持为空，被上游移除的当前模型只保留为会话状态而不再成为可选项。动态返回的模型 ID 原样用于最终推理请求，同时保持既有会话默认模型、历史回显和单轮覆盖行为。

## 复用测试 ID

- ST-S03-01 — 回归 ACP initialize/prompt 主链路。
- ST-S03-02 — 回归 ACP prompt 取消，不替代发现请求取消用例。
- ST-S20-01 — 回归密钥只通过凭据引用解析。
- ST-S20-02 — 回归既有自定义兼容网关目录获取。
- ST-S20-03 — 回归所选模型作为会话默认值。
- ST-S26-01 — 回归重启后的会话恢复与历史模型状态。
- SMOKE-core-06 — 保留既有通用真实推理冒烟回归。
- SMOKE-acp-network-01 — 保留既有 ACP 网络会话冒烟回归。
- SMOKE-acp-network-02 — 保留既有 ACP 网络模型调用冒烟回归。

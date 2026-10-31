# Agent Note: cluster-web 经具名 profile 启动

Status: implemented

[English](2026-10-30-cluster-web-named-profiles.md) | 中文

## Problem

cluster-web 部署曾以启动时覆盖出厂 `web` profile 的方式组合进程：`dsh up` 命令把部署 supervisor 包装成 profile 形态的 CLI 动词，有序 overlay 按角色改写插件行，`dsh web --api-only` 则把 profile 命令变成部署角色开关。这与 [单一 dsh 应用启动器](2026-08-22-single-dsh-application-launcher.zh.md) 规则以及 `acp-network` 此后确立的独立 profile 先例相悖，并且有具体破坏面：`dsh up` 依赖从仓库检出解析 `deploy/cluster-web/supervise.mts`，在发布安装中必然失效——那里只有随包发布的 profile。[20261012-0112 决策](../../../../logos/changes/archive/20261012-0112-cluster-web-dsh-up/proposal.md) 选定"`dsh up`、非新 profile"时，规则与先例都尚未成立；而 overlay 路径让组合悄悄漂移：runner overlay 从未设置 `runner: true`，agent-dispatch 循环早已停止运行却没有产生任何失败信号。

## Decision

cluster-web 遵循与 `acp-network` 相同的启动规则：角色是薄叠加 bundle 之上的具名 profile，部署树不含组合逻辑。

- `@deepseek-ai/dsh-cluster-web-app` 将 `web-runtime` 改为 `serveFrontend: false`，禁用 `session-persistence-jsonl`，插入 `session-persistence-postgres` 与 `stream-relay-postgres`，二者均读取 `DATABASE_URL`（变量缺失在配置校验时显式失败）。
- `@deepseek-ai/dsh-cluster-web-runner-app` 在 api 组合之上增加 `session-lease-postgres` 与 `agent-dispatch`（`nodeId` 取自 `DSH_NODE_ID`，`runner: true`，`pollMs: 250`）；缺 `DSH_NODE_ID` 在挂载时抛错。
- 出厂 profile 为 `cluster-web-api`（base + web-app + cluster-web-app）与 `cluster-web-runner`（前者再加 runner-app）。
- `dsh up` 命令移除；根脚本 `cluster-web:up` 运行 `supervise.mts`，以环境变量配置。`--api-only` flag 移除；`web` profile 自身的补丁将 `serveFrontend` 固定为 `true`。
- 部署入口只启动 profile：frontend shell 用 `--profile web`，API 副本用 `--profile cluster-web-api`，runner 用 `--profile cluster-web-runner` 加 `DSH_NODE_ID`。无 Postgres 时，API 副本追加调用时补丁 `deploy/cluster-web/overlays/no-postgres.patch.yml`（禁用 Postgres 行、重新启用 JSONL），而非把回退烘进 bundle。
- [`verify-application-entrypoints`](../../../../scripts/verify-application-entrypoints.ts) 按路径为每个 `deploy/` 入口脚本分类（`DEPLOY_ENTRY_CLASSIFICATIONS`），并在 `ROOT_LAUNCHER_POLICIES` 钉住 `cluster-web:up`；新的部署入口没有显式角色即被门禁拒绝。

## Alternatives considered

**保留 `dsh up` 加 overlay（被推翻的 20261012-0112 决策）。** 三点落败：它依赖发布安装中不存在的仓库检出；与仓库此后成文的单一启动器规则矛盾；其静默行替换掩盖了 agent-dispatch 的契约漂移。"回滚=删 overlay"的诉求并不需要命令形态。

**一个带角色 flag 的厚 `cluster-web` profile。** 否决：runner 恰是 api 组合加两行，有序 bundle 层已能表达；flag 会把 `--api-only` 式的角色开关重新引入 profile 命令。

**把无 Postgres 回退烘进 bundle。** 否决：bundle 对 `DATABASE_URL` 的显式失败契约正是配置错误的部署得以暴露的机制；Postgres 是否可用是调用时的部署事实，该选择保留为调用时补丁。

## Consequences

代价：多维护两个出厂 profile、两份升级指南（`--api-only` 移除、`dsh up` 移除），运维需把 `dsh up` 的 flag 换成环境变量。收益：所有部署拓扑统一为一种启动范式；bundle 作为 CLI 依赖随包发布，发布安装可运行 cluster-web；组合漂移改为在配置加载处失败，而非静默禁用行；部署树收缩为纯进程编排，可被入口门禁穷举分类。

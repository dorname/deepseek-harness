---
kind: upgrade-guide
description: "ACP 公布会话级 permission_policy 与 permission_preset 配置项，并新增 always 审批档：每次工具调用执行前都询问。"
---

# ACP 会话权限配置项与 always 审批档

[English](guide.md) | 中文

## 变更

此前 ACP 会话不暴露权限控制：审批策略由部署的 `approval` 插件配置（`ask` | `never`）固定。下一版本公布两个会话配置项，并新增第三个策略档：

- `permission_policy` — 在 `ask`、`never`、`always` 中单选。`ask` 行为不变。`never` 对每个询问源自动拒绝，不发起提示。`always` 在每次工具调用执行前提交审批；请求只提供一次性选项（`allow_once`、`reject_once`），永不提供持久授权。该选择按会话生效，落会话日志，resume 后保留。
- `permission_preset` — 一次调用应用部署定义的捆绑（沙箱模式 + 审批策略）；出厂目录为 `read-only`、`workspace-write`、`danger-full-access`。当各旋钮不再匹配任何捆绑时，派生的当前值读作 `custom`。

两个选项的未知值、以及后端服务未组合时的变更，都以 `Invalid params` 显式失败，不再被忽略。枚举配置选项的客户端会看到两个新 id。

读兼容：早于本版本的构建仍能打开包含 `approval/policy` 值为 `always` 事件的会话日志，但会把该值按 `ask` 分发——没有逐调用下限。`always` 保证只在升级后的读取方成立；依赖 `always` 之前先升级共享会话存储的所有读取方。部署的 `approval` 配置仍只接受 `ask` 与 `never`；`always` 是按会话、由客户端驱动的选择。

## 迁移

1. ACP 客户端：在 `session/new` 与配置变更响应中渲染或按通用方式忽略新的 `permission_policy`、`permission_preset` id。
2. 让会话采用 `always`：发送 `session/set_config_option`（`configId: "permission_policy"`、`value: "always"`），随后预期每次工具调用恰收到一次 `session/request_permission`；应答 `allow_once` 或 `reject_once`。
3. 跨版本共享会话存储的部署：使用 `always` 前先升级所有读取方；旧构建把持久化的值当 `ask` 处理。
4. 一步切换姿态：将 `permission_preset` 设为目录值，而不是分别设置两个旋钮。
5. 确认：`session/new` 列出两个 id；把 `permission_policy` 设为未知值返回 `Invalid params` 并给出可接受值；`always` 下每次工具调用恰产生一次权限请求。

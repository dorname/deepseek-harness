---
kind: upgrade-guide
description: "ACP 下不存在直接人类见证时，goal 完成与阻塞现在经 session/request_permission 向客户端征求授权，goal 工具结果新增 authorization 标记。"
---

# 经 ACP 的 goal 完成授权

[English](guide.md) | 中文

## 变更

此前，只要轮次内既无直接人类消息也未被准入的 goal round，带 `complete` 或 `blocked` action 的 `update_goal` 调用一律以 `GOAL_TOOL_AUTHORITY_REQUIRED` 失败。在组合了 user-questions 应答方之处——包括出厂 `acp` profile——工具现在把该拒绝转换为一条授权问题，并在获得授权后让模型重试：

- 征求经 `session/request_permission` 下发：选项 id `approve`（kind `allow_once`，标签 `Authorize`）与选项 id `deny`（kind `reject_once`，标签 `Deny`）。卡片排在其所审阅的 `update_goal` 工具调用之后。
- 授权绝不会经 wire 转换 goal。宿主把一条有见证的 user 消息 steer 进开放轮次——人类授权就在该轮次里——被拒调用的结果报告 `authorization: { status: 'granted', action }`；模型用相同 goal id 和 revision 重调，且只有该次重调完成或阻塞 goal。拒绝或关闭卡片让调用以原有拒绝失败，存在拒绝反馈时附带该反馈。
- 直接人类轮次与已准入的 goal round 永不征求；未组合应答方的组合照旧失败。

发布类型与导出：`@deepseek-ai/dsh-user-questions` 的 `AskUserQuestionIntent` 新增 `goal-review` 成员（`approve`、`goalId`、可选 `callId`）——仅用于呈现，忽略它的 UI 继续按通用选项列表应答。`@deepseek-ai/dsh-acp` 导出 `answerGoalReview`、`goalReviewPermissionOptions`、`GOAL_APPROVE_OPTION_ID` 与 `GOAL_DENY_OPTION_ID`。授权不产生新会话事件类型：日志只记录一条普通 user 消息加既有工具与完成事件，旧构建回放这些会话无损失。

## 迁移

1. 对每条 `session/request_permission` 一律应答 `allow_once` 的自动化 ACP 客户端：该策略现在会静默授权 goal 完成与阻塞。按 `approve`/`deny` 选项 id 过滤，或自动应答 `reject_once` 以保持原先的 fail-closed 行为。
2. 交互式客户端无需协议改动：按通用方式渲染双选项卡片，或按 `Authorize`/`Deny` 标签分支。
3. 消费 `AskUserQuestionIntent` 的宿主 UI：把 `goal-review` 呈现为 goal 授权决策，或回退到通用选项列表——两种方式的应答编码完全一致。
4. `cordis.yml` 无需改动；只有同时组合 `dsh-tool-goal` 与 user-questions 应答方之处才会激活征求。
5. 回滚：更旧构建从不发送征求，调用以 `GOAL_TOOL_AUTHORITY_REQUIRED` 失败；本版本记录的会话在其上回放不变。
6. 确认：在 ACP 会话中于直接人类轮次之外运行带 `complete` action 的 `update_goal`——恰收到一条携带 `approve`/`deny` 选项的 `session/request_permission`；应答 `approve` 后 goal 在模型重调时完成，应答 `deny` 则 goal 保持 active。

---
kind: upgrade-guide
description: "ACP 经标准界面暴露计划模式面：session/new 与 session/resume 的 modes 广告、带 plan/normal 词汇的 session/set_mode、current_mode_update 通知，以及经 session/request_permission 通道下发的计划评审。"
---

# ACP 计划模式

[English](guide.md) | 中文

## 变更

此前 ACP 会话没有模式界面，客户端无从感知或控制 dsh 计划模式。下一版本新增标准界面：

- `session/new` 与 `session/resume` 响应携带可选的 `modes` 字段——`currentModeId` 加上带显示名的 `plan`／`normal` 词汇 `availableModes`——且仅当会话组合挂载 `@deepseek-ai/dsh-plan-mode`（出厂 `dsh-base` 捆绑默认挂载）时存在。字段存在即为广告；未组合插件的组合整体省略该字段。
- `session/set_mode`（请求 `{ sessionId, modeId }`，响应 `{}`）按公布的词汇校验 id 并应用。未知 id 以 `Invalid params` 失败并给出词汇；未组合插件的组合以 internal error 失败。响应不承诺生效：由持久 `plan/mode` 事件派生的 `current_mode_update` 通知是唯一生效事实，且 agent 先于响应写入排队该通知，客户端先观察到新模式。
- 提交时机遵循计划模式控制器：轮次间的选择立即提交；轮次中的选择排队到下一次被接受的轮内 pre-step 才提交；重复选择已提交状态会静默清除反向 pending 选择，不产生通知。
- 计划评审——携带 plan-review intent 的 `exit_plan_mode` 提问——现在经 `session/request_permission` 通道下发，选项 id 为 `approve`（`allow_once`）与 `keep-planning`（`reject_once`），而不是以无应答者的 `NO_PROVIDER` 错误失败。客户端取消该权限请求会映射到工具的评审被关闭分支，会话保持其模式。其余用户提问（不同 intent、多问题批量）保持既有的无应答者行为。

## 迁移

1. ACP 客户端：存在时从 `session/new`／`session/resume` 读取 `modes` 并渲染两项；把 `current_mode_update` 通知当作权威模式状态。不关心的客户端可以全部忽略——字段可选，通知也只在显式 `session/set_mode` 或轮内计划模式切换后出现。
2. 把 `session/set_mode` 的响应当作接收确认而非生效确认：依赖新模式前等待匹配的 `current_mode_update`。该更新在 wire 上先于响应。
3. 回答 `session/request_permission` 的客户端应预期计划评审打开时的 `approve`／`keep-planning` 选项对，并像其他权限请求一样按选项 id 回答；取消产生评审被关闭行为，而不是错误。
4. 确认：`session/new` 默认报告 `currentModeId: "normal"`；未知 id 的 `session/set_mode` 以 `Invalid params` 失败并给出 `plan, normal`；resume 恢复已提交的模式。

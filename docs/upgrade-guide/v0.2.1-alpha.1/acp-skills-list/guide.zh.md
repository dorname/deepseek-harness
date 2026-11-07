---
kind: upgrade-guide
description: "ACP 新增 session/skills_list 扩展方法：按会话返回只读、invocation-neutral 的技能目录与解析后的双调用旗标。"
---

# ACP 会话技能枚举

[English](guide.md) | 中文

## 变更

此前 ACP 会话不暴露技能界面：ACP 1.4.0 未定义，编辑器等客户端无从发现会话提供哪些技能。下一版本新增一个 dsh 扩展方法：

- `session/skills_list`（请求 `{ sessionId }`）返回 `{ skills: [...] }`，按名字典序排列。每项恰含 `name`、`description` 与技能注册表解析出的 `modelInvocable`／`userInvocable` 双旗标。目录是 invocation-neutral 的：不做任何过滤，双旗标随报文下发，由各客户端按自身策略渲染或管控条目。
- 目录先解析会话预设挂载的作用域技能注册表，再回退宿主组合的全局注册表。两者皆未组合的组合以 internal error 失败并说明缺口；未知会话 id 以 `Invalid params` 失败。
- 该调用只读：不追加会话事件，重复调用结果一致，也没有变更推送——客户端重拉以观察目录变化。技能体不经 ACP 加载；调用仍走模型的 `skill` 工具或用户手势。

组合中已包含出厂 `dsh-base` 捆绑的部署已挂载技能注册表，该方法开箱即返回部署的真实目录。

## 迁移

1. ACP 客户端：在 `session/new`（或 `session/resume`）后调用 `session/skills_list` 发现目录；按旗标渲染条目，或不需要时按通用方式忽略该方法。
2. 不要把空目录当作「不支持技能」：已挂载但为空的目录返回 `[]`，未挂载注册表则以 internal error 失败并说明缺失服务。
3. 确认：响应条目按名字典序排列且恰含四个约定字段；未知会话 id 返回 `Invalid params`；重复调用返回相同目录。

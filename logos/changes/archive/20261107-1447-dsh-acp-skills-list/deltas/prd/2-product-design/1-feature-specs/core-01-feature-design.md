# delta — core-01-feature-design.md（变更 dsh-acp-skills-list）

## MODIFIED — ACP 结构说明条目（§文档前部）

将既有条目：

```markdown
- ACP：Agent Client Protocol 的 automation-only 子集（`dsh-acp`）。模型目录继续经 `session/new`、`session/resume` 与 `session/set_config_option` 的既有 `configOptions` 发布；目录发现错误经既有 JSON-RPC 错误返回，不新增 ACP 方法、字段或静态兜底目录。会话审批策略经同一 `configOptions` 面新增 `permission_policy` 与 `permission_preset` 两个 option id（S49，见 §9），仍不新增独立 ACP 方法。
```

替换为：

```markdown
- ACP：Agent Client Protocol 的 automation-only 子集（`dsh-acp`）。模型目录继续经 `session/new`、`session/resume` 与 `session/set_config_option` 的既有 `configOptions` 发布；目录发现错误经既有 JSON-RPC 错误返回，不新增方法、字段或静态兜底目录。会话审批策略经同一 `configOptions` 面新增 `permission_policy` 与 `permission_preset` 两个 option id（S49，见 §9）。技能清单以 bridge 扩展方法 `session/skills_list` 按需枚举（S50，见 §10；ACP 1.4.0 无技能标准面，该方法为 dsh 扩展方法，是本节所述面中唯一的标准面外新增方法）。
```

## ADDED — §10 会话技能清单交互规格（S50）

在 §9 之后追加：

```markdown
## 10. 会话技能清单交互规格（S50）

### S50: 外部客户端枚举会话技能清单 — 方法与字段规格

**方法**：`session/skills_list`，bridge 扩展方法（ACP 1.4.0 无技能标准面，方法名与字段为 dsh 扩展，文档明示）。请求 `{ sessionId }`；响应 `{ skills: [{ name, description, modelInvocable, userInvocable }] }`。`name` 为 kebab-case 标识（与会话内 `/name` 引用一致）；`description` 为完整路由描述，全文返回不截断；`modelInvocable` / `userInvocable` 为解析后的双调用旗标，不做任何调用面过滤——手势专属与模型专属技能均列出，客户端按旗标自行区分 UI 入口。

**内部接口**：bridge 校验会话归属（未知会话 invalid params）后，复用 `SessionSkillCatalog` 的解析逻辑：会话恒有 live agent，经 `agentPresets.serviceFor(agent, 'skills')` 取预设作用域注册表，缺失回退全局 `ctx.get('skills')`；`cwd` 取会话 header；以 `{ cwd, scope }` 列出并按名字典序返回。技能注册表未组装时 fail-loud（internal error 类，说明缺装配），与既有 `skill-catalog` 姿态一致。枚举只读：不落会话事件、不缓存快照（每次调用经注册表自身缓存即时发现）、不改 `SessionEventMap` 与双 SDK 会话接口。既有 `skills/list` Typert Remote 保持 userInvocable 过滤不变（dsh 自有 UI 人类命令目录是不同的消费边界）。

### 边界与后续增量

- `skills/change` 实时推送不在本期；后续可镜像 topologyChanged → config_option_update 推送模式作为增量。
- 经 ACP 加载技能体不在本期：技能调用仍只经 `skill` 工具（模型路径）与用户手势注入（user 路径），本方法只做目录发现。
- `path` / `whenToUse` 不暴露：绝对路径泄漏本地文件系统结构；`whenToUse` 为 dsh 内部路由语义，dspm 未请求。

### 验收条件（交互级）

##### 正常：枚举与双旗标
- **GIVEN** 客户端在已有技能目录的工作区创建会话
- **WHEN** 调用 `session/skills_list`
- **THEN** 响应列出全部技能及双旗标，按名字典序排列；手势专属技能 `modelInvocable=false`、模型专属技能 `userInvocable=false`
##### 异常：未知会话
- **GIVEN** 客户端以未知会话 id 调用
- **WHEN** `session/skills_list`
- **THEN** 返回 invalid params 类错误
##### 异常：注册表缺失 fail-loud
- **GIVEN** 部署未组装技能注册表
- **WHEN** `session/skills_list`
- **THEN** 返回 internal error 类错误并说明缺装配，不返回空列表
##### 回归：既有面不变
- **GIVEN** 未升级的既有 ACP 客户端与 dsh 自有 UI
- **WHEN** 执行 new/resume/prompt 与 `skills/list` 回归
- **THEN** 既有方法请求/响应结构不变；`skills/list` 过滤行为不变
```

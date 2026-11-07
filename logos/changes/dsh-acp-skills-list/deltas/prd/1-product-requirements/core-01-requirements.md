# delta — core-01-requirements.md（变更 dsh-acp-skills-list）

## MODIFIED — 三、场景总览（表格追加一行）

在场景总览表 S49 行后追加：

```markdown
| S50 | 外部客户端枚举会话技能清单 | 外部 ACP 客户端拉取会话可用技能及调用面旗标 | P01/P08 | P0 |
```

## ADDED — 四、核心场景详述：S50

在 §四 S49 小节之后、"## 五、约束与边界" 之前插入：

```markdown
### S50: 外部客户端枚举会话技能清单

- **触发条件**：外部 ACP 客户端（如 dspm）在会话上调用 `session/skills_list`，拉取该会话可见的技能清单及每项技能的调用面旗标。
- **用户价值**：dspm 的技能入口展示与 dsh 技能发现规则（根目录、优先级、同名覆盖）保持同源，无需在客户端复制发现逻辑；按 `modelInvocable` / `userInvocable` 双旗标区分模型调用与用户手势入口（← P01/P08）。
- **优先级**：P0
- **主路径**：客户端 `session/skills_list { sessionId }` → bridge 校验会话归属 → 按会话解析技能注册表（live agent 预设作用域注册表优先，缺失回退全局注册表）→ 以会话 `cwd` 与作用域列出全部技能（不做调用面过滤）→ 响应 `{ skills: [{ name, description, modelInvocable, userInvocable }] }`，按名字典序排列。
- **边界**：方法为只读枚举，不落会话事件、不进入模型 transcript；`description` 全文返回不截断；`path` / `whenToUse` 不暴露；技能注册表未组装时 fail-loud（internal error 类），不返回空列表；`skills/change` 实时推送与经 ACP 加载技能体不在范围；既有 `skills/list` Typert Remote（dsh 自有 UI 通道，保留 userInvocable 过滤）行为不变。
```

## ADDED — 四、S50 验收条件

接在 S50 边界段之后：

```markdown
#### 验收条件
##### 正常：清单枚举与双旗标
- **GIVEN** 会话所在工作区存在含手势专属（model-invocable 关闭）与模型专属（user-invocable 关闭）技能的技能目录
- **WHEN** 客户端调用 `session/skills_list`
- **THEN** 响应列出全部技能（含两类专属技能），每项含 `name`、`description`、`modelInvocable`、`userInvocable`，按名字典序排列；旗标与技能 frontmatter 解析结果一致
##### 正常：预设作用域解析
- **GIVEN** 会话由挂载技能插件预设的 agent 派生，预设作用域注册表与全局注册表存在同名覆盖
- **WHEN** 客户端调用 `session/skills_list`
- **THEN** 清单按最近层同名覆盖规则取胜者，与会话内 `skill` 工具可见目录一致
##### 异常：未知会话与注册表缺失 fail-loud
- **GIVEN** 客户端对未知会话 id 调用，或部署未组装技能注册表
- **WHEN** `session/skills_list`
- **THEN** 未知会话返回 invalid params 类错误；注册表缺失返回 internal error 类错误并说明缺装配，均不返回空列表、不静默降级
##### 正常：只读无副作用
- **GIVEN** 任意会话多次调用 `session/skills_list`
- **WHEN** 对照调用前后的会话日志
- **THEN** 无新增会话事件；同一目录状态下重复调用结果一致；模型 transcript 不受影响
##### 回归：既有通道与会话行为
- **GIVEN** S03、S49 既有会话与 dsh 自有 UI 的 `skills/list` Remote
- **WHEN** 执行 ACP 主链路、审批策略回归与 `skills/list` 调用
- **THEN** 既有行为保持；`skills/list` 仍仅返回 userInvocable 技能；ACP 会话 new/resume/prompt 响应结构不变
```

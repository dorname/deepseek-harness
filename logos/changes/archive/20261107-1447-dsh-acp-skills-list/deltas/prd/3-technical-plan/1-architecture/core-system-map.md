# delta — core-system-map.md（变更 dsh-acp-skills-list）

## ADDED — §15 ACP 会话技能清单入口（S50）

在 §14（ACP 会话审批策略入口）之后追加：

```markdown
## 15. ACP 会话技能清单入口（S50）

| 组件 | 位置 | 职责 |
|---|---|---|
| 技能注册表 | `packages/skill/skill/src/index.ts` | 既有 invocation-neutral `list({cwd, scope})`：分层合并（全局层 + 作用域链，最近层同名覆盖）、名字典序、返回含 `invocation` 双旗标的 `SkillSummary` |
| 预设作用域解析 | `packages/preset/agent-preset-registry/src/index.ts` | 既有 `serviceFor(agent, 'skills')`：live agent 的预设挂载注册表优先，缺失回退全局 `ctx.get('skills')` |
| ACP bridge 扩展方法 | `packages/acp/acp/src/bridge.ts` | 新增 `session/skills_list`：会话归属校验 → 解析注册表 → 以会话 cwd 与作用域列出全部技能（不过滤）→ 映射 `{name, description, modelInvocable, userInvocable}` 返回 |
| 既有 UI 通道 | `packages/api/session-controller/src/skill-catalog.ts` | 不变：`skills/list` Typert Remote 保留 userInvocable 过滤（人类命令目录边界） |

- ACP 1.4.0 无技能标准面：`session/skills_list` 以 SDK 扩展方法注册（原始方法名 + 参数解析器），扩展属性在 ACP README 与升级指南明示。
- 注册表缺失 fail-loud（internal error 类），不返回空列表；错误姿态与 `skill-catalog` 的 `gateway/internal` 一致。
- 方法只读：不落会话事件、不改 `SessionEventMap`、无持久化面变更；`skills/change` 推送为后续增量（不在本变更）。
- 调用面策略在消费边界施加：注册表返回 invocation-neutral 数据，dsh 自有 UI 通道过滤 userInvocable，ACP 客户端按双旗标自行过滤。
```

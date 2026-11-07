# delta — acp-network-system-map.md（变更 dsh-acp-skills-list）

## ADDED — 会话技能清单方法面（S50）

在「会话审批策略配置面（S49）」一节之后追加：

```markdown
## 会话技能清单方法面（S50）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，技能枚举以 bridge 扩展方法注册，因此不需要新增网络路由或 dspm 侧协议复制；ACP 1.4.0 无技能标准面，`session/skills_list` 是 dsh 扩展方法（文档明示扩展属性）。

```
│ ACP client (dspm)                           │ ACP server (bridge)                    │
│ session/skills_list { sessionId } ────────▶ │ 会话归属校验 → 解析注册表 → 枚举        │
│ ◀──────── { skills: [{name, description,    │ （live agent 预设作用域 → 全局回退，    │
│            modelInvocable, userInvocable}] }│  cwd 取会话 header，不过滤双旗标）      │
```

- 未知会话：invalid params 类 JSON-RPC 错误（与既有 requireSession 姿态一致）。
- 技能注册表未组装：internal error 类错误并说明缺装配，fail-loud，不返回空列表。
- 方法只读、按需拉取：不落会话事件、不在 bridge 缓存快照；每次调用经注册表自身缓存即时发现，清单随目录状态即时。
- 双旗标语义：`modelInvocable=false` 为手势专属（`disable-model-invocation`），`userInvocable=false` 为模型专属；dspm UI 据此区分入口，服务端不做过滤。
- 既有 `session/request_permission` 回环、configOptions 面与 prompt/resume 行为不受影响；`skills/change` 实时推送为后续增量。
```

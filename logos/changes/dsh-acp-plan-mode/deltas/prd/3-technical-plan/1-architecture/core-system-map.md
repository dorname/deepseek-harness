# delta — core-system-map.md（变更 dsh-acp-plan-mode）

## ADDED — §16、ACP 计划模式入口（S51）

在 §15（ACP 会话技能清单入口）之后追加：

```markdown
## 16. ACP 计划模式入口（S51）

| 组件 | 位置 | 职责 |
|---|---|---|
| PlanModeController | `packages/plan/plan-mode/src/index.ts` | 既有模式状态服务：`set(agent, active)` 四态结果（committed/queued/cancelled/noop）、log-only `plan/mode` 事件、`plan` 投影折叠与 resume 恢复、回合间立即提交与回合中 pre-step 排队 |
| ACP bridge 模式面 | `packages/acp/acp/src/bridge.ts` | 新增标准方法 `session/set_mode` 注册（词表校验、错误分类）；new/resume 响应广告可选 `modes`（plan/normal 二值、已提交状态、插件缺席省略） |
| ACP 会话事件派发 | `packages/acp/acp/src/session.ts` | 新增 `plan/mode` → `current_mode_update` 派生推送（经既有 outputTail 排序，bridge 不合成通知） |
| 计划评审应答者 | `packages/acp/acp/src/bridge.ts` | 新增 `user-questions/request` 瀑布应答者（连接生命周期注册/释放）：plan-review intent → `session/request_permission` approve/keep-planning 映射；其余请求放行既有瀑布 |
| 既有计划模式通道 | `packages/plan/plan-mode`、web 投影 | 不变：`/plan` 命令、`{ active, pending }` 投影、`exit_plan_mode` 稳定工具目录 |

- ACP 1.4.0 标准面：`session/set_mode`、`SessionModeState`、`current_mode_update` 均为协议既有类型，dsh 注册实现并按会话状态填充；无扩展方法、无新增 capability 位（`modes` 字段在场即广告）。
- 时序契约：`set_mode` 响应恒 `{}` 不承诺生效，`current_mode_update`（由持久 `plan/mode` 事件派生）是唯一生效事实；回合中切换为 queued，至下一个 accepted in-turn pre-step 提交。
- plan-mode 插件缺席 fail-loud：`set_mode` internal error 并说明缺装配，new/resume 省略 `modes`；不静默降级。
- plan-review 复用审批通道（不依赖 REQ-D6）：仅拦截自有会话上的单问题 plan-review intent，其余问题保持 `NO_PROVIDER`；修复 ACP 下 `exit_plan_mode` 因无应答者必然工具报错的缺陷。
- 强制只读不在本变更：plan mode 不读 sandbox/审批状态；mode→preset 联动为条件性后续（需求方提出时另立项）。
- 零持久化面变更：复用 S11 既有 `plan/mode` 事件与投影，`SessionEventMap` 不变，Session format 维持 4。
```

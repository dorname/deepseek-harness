# delta — acp-network-system-map.md（变更 dsh-acp-plan-mode）

## ADDED — 计划模式方法面（S51）

在「会话技能清单方法面（S50）」一节之后追加：

```markdown
## 计划模式方法面（S51）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，计划模式走 ACP 1.4.0 标准面（`session/set_mode` + `modes` 广告 + `current_mode_update`），不需要新增网络路由、扩展方法或 dspm 侧协议复制。

```text
│ ACP client (dspm)                           │ ACP server (bridge)                        │
│ session/new|resume ────────────────────────▶ │ 响应含 modes { currentModeId,              │
│ ◀──────── { modes: {currentModeId,          │  availableModes: [plan, normal] }（插件缺席 │
│            availableModes }] }              │  省略字段）                                │
│ session/set_mode { sessionId, modeId } ────▶ │ 词表校验 → PlanModeController.set          │
│ ◀──────── {} （不承诺生效）                  │  （committed/queued/cancelled/noop）       │
│ ◀─ session/update: current_mode_update ──── │ plan/mode 事件提交时派发（唯一生效事实）    │
│ ◀─ session/request_permission ───────────── │ exit_plan_mode 评审：approve/keep-planning │
│ ◀──────── outcome ────────────────────────  │ （approve 映射批准，其余映射继续规划）      │
```

- 词表与错误：modeId 仅接受 `plan` / `normal`（未知值 invalid params 并给出词表）；未知会话 invalid params；会话关闭中 invalid params；plan-mode 插件缺席 internal error（fail-loud，`modes` 整体省略）。
- 时序：回合间切换立即提交并紧随更新；回合中切换响应先行、更新随下一个 accepted pre-step 到达；noop 与 cancelled 无更新；resume 广告已提交状态。
- plan-review 复用既有 `session/request_permission` 回环与 TLS/鉴权面：新增 optionId 词表 `approve` / `keep-planning`（kind 映射 allow_once / reject_once），评审卡片在工具调用卡片之后到达（drainUpdates 排序）；评审之外的问题保持无应答者语义（REQ-D6 范围）。
- 既有 configOptions 面、prompt/resume、审批策略与技能枚举行为不受影响；`modes` 为新增可选字段，旧客户端按可选字段容忍。
```

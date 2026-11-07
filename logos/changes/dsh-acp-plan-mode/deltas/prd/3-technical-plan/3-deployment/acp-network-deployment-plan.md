# delta — acp-network-deployment-plan.md（变更 dsh-acp-plan-mode）

## ADDED — 计划模式入口发布（S51）

在「会话技能清单入口发布（S50）」一节之后追加：

```markdown
## 计划模式入口发布（S51）

- 发布物包含 `acp` 标准方法 `session/set_mode` 注册、new/resume `modes` 广告、`current_mode_update` 派发与 plan-review 评审应答者；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- `acp-network` profile 经 `dsh-base` 已挂载 `@deepseek-ai/dsh-plan-mode`，部署无需新增装配或配置。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加模式面验证：
  1. 有效 token 连接后 `session/new`，核对响应 `modes` 为 plan/normal 二值且 `currentModeId` 为 normal。
  2. `session/set_mode { modeId: 'plan' }` 后核对 `current_mode_update` 到达；`session/resume` 后 `currentModeId` 恢复为 plan；切回 normal 同样核对。
  3. 重复设置当前模式确认无冗余更新；对未知 modeId 验证 invalid params 词表错误。
  4. 回归既有 prompt/resume、审批策略（S49）与技能枚举（S50）路径。
- plan-review 的 request_permission 映射依赖模型调用 `exit_plan_mode`，不在确定性冒烟范围，由单元与真实 API e2e 承载；dspm 集成验收可在真实会话中触发计划评审并复用三态映射断言。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更零新增持久化数据，回滚无迁移；回滚后旧构建对 `session/set_mode` 返回 -32601、`modes` 字段消失（客户端按可选字段容忍）。
- relay 侧实现不需要为 S51 增加新语义：`current_mode_update` 与评审请求均为标准 JSON-RPC 帧透传；dspm UI 侧需实现 optionId 词表（approve / keep-planning）的评审卡片。
```

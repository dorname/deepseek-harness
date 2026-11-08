# delta — acp-network-deployment-plan.md（变更 dsh-acp-goal-approval）

## ADDED — goal 授权卡 staging 验证与 dspm 部署指引

在既有 staging 验证小节后追加：

```markdown
### goal 授权卡（S54）

- staging ACP 会话内驱动未授权 goal 完成（mock 模型触发 `complete` 调用即可），验证 `session/request_permission` 携带 Authorize/Deny 选项词汇、Authorize 应答后完成提交且会话日志含注入的源 user 用户消息（SMOKE-acp-network-08；本地通道全量执行，staging 无交互握手按 skip 语义记录，永不报 PASS）。
- dspm 侧指引：goal 授权卡是普通权限卡片（`session/request_permission`），按既有选项卡片处理；无需 capability 声明；`goal-review` 意图为可选呈现优化——识别后可渲染为 goal 审批卡，不识别则通用选项卡同样可用（应答编码不变）。
- Deny/取消路径与无通道 fail-fast（headless 组合）纳入回归；plan-review 卡（S51）不受新应答者影响。
```

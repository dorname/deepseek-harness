# delta — acp-network-deployment-plan.md（变更 dsh-acp-permission-policy）

## ADDED — 会话审批策略配置发布（S49）

- 发布物包含 `acp` 审批策略入口实现；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加会话级审批策略验证：
  1. 有效 token 连接后 `session/set_config_option { permission_policy: 'always' }`。
  2. 发起带工具调用的 prompt，验证 `session/request_permission` 在 WebSocket 双向帧上往返 ≤5s，allow-once 后工具执行。
  3. 对第二次调用 reject-once，验证调用被拒且会话继续、`stopReason` 正常结算。
  4. 设置 `permission_policy=paranoid` 验证 invalid params 与状态不变。
  5. `session/close` → 新连接 resume，验证策略经折叠恢复且 configOptions 回显。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；回滚后旧构建拒绝打开含 `approval/policy-always` 事件的会话（fail-loud 报未知事件类型），仅含 ask/never 的会话完全可读；已记录于持久化变更记录，不作为回滚前置条件。
- 权限应答保持一次性选项（allow-once / reject-once / cancelled），relay 侧实现不需要为 S49 增加新的应答语义。

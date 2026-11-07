# delta — core-01-deployment-plan.md（变更 dsh-acp-plan-mode）

## ADDED — §十三、ACP 计划模式入口发布（S51）

在 §十二（ACP 技能清单入口发布）之后追加：

```markdown
## 十三、ACP 计划模式入口发布（S51）

### 发布物与前置检查

- 发布物为包含 `acp` 模式面与评审应答者变更及对应文档的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认受影响单元、真实 Loader 组合、ACP 集成、keyless 快照和聚焦 coverage 通过；部署后 smoke 与真实 API e2e 分别记录。
- 发布包含 `docs/upgrade-guide/<发布版本>/acp-plan-mode/` 中英文指南，说明标准方法语义、modes 词表、queued 时序契约（响应不承诺生效、以 current_mode_update 为准）、plan-review optionId 词表与插件缺席 fail-loud 行为。

### 配置

- 不新增 Secret、环境变量或 profile 配置项；`acp` / `acp-network` profile 经 `dsh-base` 已挂载 `@deepseek-ai/dsh-plan-mode`，部署无需新增装配。
- 自定义 profile 若剥离 plan-mode 插件，`session/set_mode` 返回 internal error 且 new/resume 省略 `modes`（fail-loud）——这是文档化行为，不是部署缺陷。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. staging 启动含 acp-network profile 的 dsh 实例，既有 Secret 与 token 签发流程不变。
3. 执行 SMOKE-acp-network-05：new/resume 响应 `modes` 广告核对、`set_mode` plan/normal 往返与 `current_mode_update` 时序、重复设置无冗余更新、未知 modeId 错误分支、resume 恢复已提交模式。
4. 检查既有 prompt/resume、S49 审批策略、S50 技能枚举与 `/plan` 命令（自有 UI 通道）回归保持。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile；本变更零新增持久化数据（复用 S11 既有 `plan/mode` 事件），回滚无迁移。
- 回滚后旧构建不认识 `session/set_mode`（客户端得 -32601）、`modes` 字段不再出现（客户端按可选字段容忍）；计划模式下经 ACP 的 `exit_plan_mode` 评审回到无应答者行为（升级指南已按既有缺陷如实说明）。
- 部署后检查：`modes` 广告结构合法、set_mode 往返 ≤2s、`current_mode_update` 到达、未知 modeId 错误分支生效、SMOKE-acp-network-01..04 既有回归保持。
```

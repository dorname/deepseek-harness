# delta — core-01-deployment-plan.md（变更 dsh-acp-goal-approval）

## ADDED — §十六 goal 授权经 ACP 发布（S54）

在 §十五 之后追加（文件末尾）：

```markdown
## 十六、goal 授权经 ACP 发布（S54）

### 发布物与前置检查

- 发布物为包含 tool-goal 授权征求、goal-review 意图与 ACP 桥接应答者的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认单元（ask/steer/deny/无通道/既有授权路径回归）、真实 Loader 组合 ST、快照（steer 消息与工具结果文本）与聚焦 coverage 通过；部署后 smoke 与回归分别记录。
- 零新增 Config（无 config-catalog 变更）；发布包含 `docs/upgrade-guide/<发布版本>/acp-goal-approval/` 中英文指南：ask 行为变化（有通道时会征求）、goal-review 意图、Deny/取消语义、无通道行为不变、goal-review 意图为宿主内呈现类型（双 SDK 零改动）。

### 配置

- 不新增 Secret、环境变量或组合配置键；goal 工具的征求行为由 userQuestions 通道存在性决定（`ctx.get('userQuestions')`），无部署侧开关。
- ACP 客户端无需 capability 声明：goal 授权卡经既有 `session/request_permission` 到达，客户端按普通权限卡片处理即可；识别 `goal-review` 意图的客户端可做呈现优化（协议不依赖）。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. staging ACP 会话内驱动一次未授权 goal 完成：mock/真实模型触发 `complete` 调用 → 客户端收 `session/request_permission`（Authorize/Deny 词汇）→ 应答 Authorize → 会话日志核对注入的源 user 用户消息与完成事件（SMOKE-acp-network-08；staging 无交互握手时按 skip 语义记录，永不报 PASS）。
3. 验证 Deny 与取消路径（无注入、既有拒绝注明拒绝）、无通道 fail-fast（headless 组合）、admitted round 与 direct-human 路径不征求。
4. 回归 SMOKE-acp-network-01..07 与 S49（审批策略）、S51（plan-review）、S03（ACP 主链路）面。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile；零新增持久化事件类型，回滚无迁移；注入的授权消息是普通 `user/message`，旧构建读取无损。
- 旧构建无 ask 行为：未授权完成回到立即 `GOAL_TOOL_AUTHORITY_REQUIRED`；进行中的征求随旧进程终止，无残留状态。
- 部署后检查：授权卡往返全链路（SMOKE-acp-network-08）、Deny/取消路径、无通道 fail-fast、plan-review 意图应答不受影响、SMOKE-acp-network-01..07 既有回归保持。
```

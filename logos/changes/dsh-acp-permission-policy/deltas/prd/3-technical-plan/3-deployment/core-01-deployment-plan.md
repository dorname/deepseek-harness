# delta — core-01-deployment-plan.md（变更 dsh-acp-permission-policy）

## ADDED — 十一、ACP 审批策略配置发布（S49）

### 发布物与前置检查

- 发布物为包含 `acp`、`interaction/user-approval`、`interaction/permission-presets`、`core/tools` 及对应文档变更的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认受影响单元、真实 Loader 组合、ACP 集成、keyless 快照和聚焦 coverage 通过；部署后 smoke 与真实 API e2e 分别记录。
- 发布包含 `docs/upgrade-guide/<发布版本>/acp-permission-policy/` 中英文指南，说明新增 option id、`always` 词表值、一次性选项语义保持与 fail-closed 行为。
- `approval/policy` 事件携带新值 `always` 的读兼容性（required-on-read 语义）在实现期评估；评估结论与所选机制记录在实现清单，不依赖日志向前兼容完成回滚。

### 配置

- 不新增 Secret、环境变量或 profile 配置项；审批策略是会话级状态，由客户端按会话设置，部署侧无需预置。
- 未设置策略的会话保持默认 `ask` 放行语义，升级前后行为一致；部署不为任何会话预置 `always`/`never`。
- 无数据库或 Session 格式迁移；策略与预设沿用既有 `approval/policy` 会话事件持久化。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. staging 启动含 acp-network profile 的 dsh 实例，既有 Secret 与 token 签发流程不变。
3. 执行 SMOKE-acp-network-03：会话设置 `permission_policy=always` 后发起工具调用，验证 `session/request_permission` 往返与 allow-once 执行；对另一次调用 reject-once 验证拒绝分支；回归 `permission_preset` 预设应用。
4. 检查未知策略值返回 invalid params、状态不变；未配置策略的既有会话默认行为不变。
5. 写入部署报告与结果后才标记部署完成；审批往返不可复现时不得把 S49 验收标为 PASS。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile；回滚不迁移或删除会话数据，既有审批/预设会话事件按旧版语义读取（旧版不识别 `always` 值的行为已在实现期评估并记录）。
- 部署后检查：configOptions 广告含新 option id、`always` 往返 5s 内完成、fail-closed 分支可复现、SMOKE-acp-network-01/02 既有回归保持。

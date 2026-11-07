# delta — core-01-deployment-plan.md（变更 dsh-acp-compaction）

## ADDED — §十四、ACP 会话压缩入口发布（S52）

在 §十三（ACP 计划模式入口发布）之后追加：

```markdown
## 十四、ACP 会话压缩入口发布（S52）

### 发布物与前置检查

- 发布物为包含 `acp` 压缩方法与通知派发变更及对应文档的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认受影响单元、真实 Loader 组合、ACP 集成、keyless 快照和聚焦 coverage 通过；部署后 smoke 与真实 API e2e 分别记录。
- 发布包含 `docs/upgrade-guide/<发布版本>/acp-compaction/` 中英文指南，说明扩展方法属性、六失败码 data.code 词表、capability 门控通知与 UNSTABLE 属性、压缩服务缺席 fail-loud 行为。

### 配置

- 不新增 Secret、环境变量或 profile 配置项；`acp` / `acp-network` profile 经 `dsh-base` 已挂载 `@deepseek-ai/dsh-compaction-basic` 与 `@deepseek-ai/dsh-command-compact`，部署无需新增装配。
- 自定义 profile 若剥离压缩插件，`session/compact` 返回 internal error（fail-loud）——这是文档化行为，不是部署缺陷。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. staging 启动含 acp-network profile 的 dsh 实例，既有 Secret 与 token 签发流程不变。
3. 执行 SMOKE-acp-network-06：真实模型产历史后压缩往返、`{ result: null }` 分支、busy 竞态、未知会话错误、能力声明客户端的 `compaction_update` 核对与未声明客户端零通知。
4. 检查既有 prompt/resume、S49/S50/S51 路径与 `/compact` 命令（自有 UI 通道）回归保持。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile；本变更零新增持久化数据（复用 S15 既有 `compaction/*` 事件），回滚无迁移；已压缩会话的日志格式不变，旧构建可正常打开。
- 回滚后旧构建不认识 `session/compact`（客户端得 -32601）；声明能力的客户端不再收到 `compaction_update`（客户端按通知缺席容忍）。
- 部署后检查：压缩往返 ≤ 部署基线（真实模型耗时为主）、响应结构合法、busy 竞态分支生效、通知门控正确（声明者有、未声明者无）、SMOKE-acp-network-01..05 既有回归保持。
```

# delta — core-01-deployment-plan.md（变更 dsh-acp-session-export）

## ADDED — §十七、会话导出经 ACP 发布（S55）

在 §十六 之后（文档末尾）插入：

```markdown
## 十七、会话导出经 ACP 发布（S55）

### 发布物与前置检查

- 发布物为包含 bridge 导出三方法、dsh-acp 导出 Config 与可选服务注入增补的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认单元（begin/read/eof/cancel/unknown_cursor/服务缺席/并发快照/quiesce 清理）、真实 Loader 组合、快照（wire 契约结构断言）与聚焦 coverage 通过；部署后 smoke 与回归分别记录。
- 新增两个 dsh-acp Config 键（`exportChunkBytes`、`exportCompressionLevel`）：config-catalog 同步重生成；发布包含 `docs/upgrade-guide/<发布版本>/acp-session-export/` 中英文指南（三方法契约、错误词表、可见性声明、拉式消费形态、向后兼容性）。

### 配置

- 新增 Config 均为加载期校验的部署旋钮：`exportChunkBytes`（默认 262144；16384–4194304 之外加载失败）、`exportCompressionLevel`（0–9，默认 6）。零新增 Secret、环境变量。
- ACP 客户端无需 capability 声明：导出是纯请求序列（begin → read × N → eof，中止用 cancel）；未部署导出方法的旧服务返回 methodNotFound，客户端可据此探测降级。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. staging ACP 会话内驱动一次导出往返：创建会话并产生若干事件 → `export_begin` → `export_read` 循环至 eof → 解包断言 `session.v4.jsonl` 首条目与事件内容（SMOKE-acp-network-09；纯方法调用无交互握手，staging 具备条件即执行，不满足时按 skip 语义如实记录，永不报 PASS）。
3. 验证 cancel → `unknown_cursor` 路径、未知游标 invalid params、`includeDescendants=true` 的 subagents 条目、Config 越界加载 fail-loud（越界值启动即失败）。
4. 回归 SMOKE-acp-network-01..08 与 S26（web 导出 HTTP 面）、S49..S54 既有 ACP 方法面、S03（ACP 主链路）。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile；零新增持久化事件类型，回滚无迁移；旧构建上导出方法不存在（methodNotFound），会话日志单向兼容、读取无损。
- 部署后检查：导出往返全链路（SMOKE-acp-network-09）、cancel/unknown_cursor 路径、web 导出 HTTP 面不受影响、SMOKE-acp-network-01..08 既有回归保持。
```

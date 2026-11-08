# delta — acp-network-deployment-plan.md（变更 dsh-acp-compaction）

## ADDED — 会话压缩入口发布（S52）

在「计划模式入口发布（S51）」一节之后追加：

```markdown
## 会话压缩入口发布（S52）

- 发布物包含 `acp` 扩展方法 `session/compact` 与 capability 门控的 `compaction_update` 派发；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- `acp-network` profile 经 `dsh-base` 已挂载压缩服务与命令插件，部署无需新增装配或配置；自动触发阈值等压缩策略仍为部署配置所有，本变更不新增旋钮。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加压缩面验证：
  1. 有效 token 连接后 `session/new`，真实模型 prompt 产历史，调用 `session/compact { sessionId }`。
  2. 核对成功响应结构（compactionId / summarySeq / shadowedCount / shadowedTokenCount / summary）；`session/resume` 后历史已被 shadow 替换。
  3. 压缩进行中并发第二次调用验证 `data.code: 'busy'`；对未知会话 id 验证 invalid params。
  4. 声明 `clientCapabilities.session.compaction` 的连接核对 `compaction_update`（in_progress → completed）；未声明的连接核对零通知。
  5. 回归既有 prompt/resume、审批策略（S49）、技能枚举（S50）、计划模式（S51）与 `/compact` 命令路径。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更零新增持久化数据，已压缩会话旧构建可正常打开，回滚无迁移。
- relay 侧实现不需要为 S52 增加新语义：方法与通知均为普通 JSON-RPC 帧，透传即可；dspm 客户端按其 §6 答复决定是否声明 compaction 能力（不声明即纯同步语义）。
```

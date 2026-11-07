# delta — acp-network-deployment-plan.md（变更 dsh-acp-skills-list）

## ADDED — 会话技能清单入口发布（S50）

在「会话审批策略配置发布（S49）」一节之后追加：

```markdown
## 会话技能清单入口发布（S50）

- 发布物包含 `acp` 技能枚举扩展方法实现；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- `acp-network` profile 经 `dsh-base` 已挂载技能注册表与文件系统发现插件，部署无需新增装配或配置。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加技能枚举验证：
  1. 有效 token 连接后 `session/new`，调用 `session/skills_list { sessionId }`。
  2. 验证响应为 `{ skills: [...] }` 数组、按名字典序排列、每项含 `name` / `description` / `modelInvocable` / `userInvocable`；与部署环境已知技能目录（用户级与项目级根目录）核对一致性。
  3. 对未知会话 id 调用，验证 invalid params 类错误。
  4. 回归既有 prompt/resume、`skills/list` UI 通道与 S49 审批策略路径。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更只读且无会话数据与配置变更，回滚无迁移。
- relay 侧实现不需要为 S50 增加新语义：方法请求/响应均为普通 JSON-RPC 帧，透传即可。
```

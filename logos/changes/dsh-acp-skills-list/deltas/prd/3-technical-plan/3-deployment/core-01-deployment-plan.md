# delta — core-01-deployment-plan.md（变更 dsh-acp-skills-list）

## ADDED — §十二、ACP 技能清单入口发布（S50）

在 §十一（ACP 审批策略配置发布）之后追加：

```markdown
## 十二、ACP 技能清单入口发布（S50）

### 发布物与前置检查

- 发布物为包含 `acp`、`skill`、`preset/agent-preset-registry` 及对应文档变更的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认受影响单元、真实 Loader 组合、ACP 集成、keyless 快照和聚焦 coverage 通过；部署后 smoke 与真实 API e2e 分别记录。
- 发布包含 `docs/upgrade-guide/<发布版本>/acp-skills-list/` 中英文指南，说明新扩展方法、字段语义（双旗标、不过滤）、fail-loud 行为与扩展方法属性。

### 配置

- 不新增 Secret、环境变量或 profile 配置项；`acp` 与 `acp-network` profile 经 `dsh-base` 已挂载 `@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-skill-filesystem`，部署无需新增装配。
- 自定义 profile 若剥离技能插件，`session/skills_list` 返回 internal error（fail-loud）——这是文档化行为，不是部署缺陷。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. staging 启动含 acp-network profile 的 dsh 实例，既有 Secret 与 token 签发流程不变。
3. 执行 SMOKE-acp-network-04：会话创建后调用 `session/skills_list`，验证响应结构（数组、字典序、四字段）与部署环境已知技能目录一致；对未知会话 id 验证 invalid params 分支。
4. 检查既有 `skills/list` Typert Remote、prompt/resume 与 S49 审批策略路径回归保持。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile；本变更只读、无会话数据与配置变更，回滚无迁移。
- 部署后检查：`skills_list` 响应 ≤2s、结构合法、未知会话错误分支生效、SMOKE-acp-network-01/02/03 既有回归保持。
```

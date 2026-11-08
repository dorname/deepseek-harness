# delta — core-01-deployment-plan.md（变更 dsh-acp-multi-provider）

## ADDED — §十五、多供应商路由供给发布（S53）

在 §十四（ACP 会话压缩入口发布）之后追加：

```markdown
## 十五、多供应商路由供给发布（S53）

### 发布物与前置检查

- 发布物为包含 llm-pi-ai 配置双形态与归一化及对应文档的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认单元、真实 Loader 组合、配置面冲突矩阵与聚焦 coverage 通过；部署后 smoke 与回归分别记录。
- config-catalog 重生成随发布交付（配置 schema 变化）。
- 发布包含 `docs/upgrade-guide/<发布版本>/acp-multi-provider/` 中英文指南：双形态定义、settings dict-only、冲突 fail-loud 词表、dict-vs-数组选型说明、dspm 组合示例。

### 配置

- 不新增 Secret 或环境变量；新增组合配置输入形式（`llm-pi-ai.providers` 数组）。apiKeyEnv 引用的凭据经既有凭据解析（凭据存储或环境，键不入配置）。
- acp-network 的 `provider` / `model` 值对不变；默认路由须指向已注册路由，否则会话创建 fail-loud（既有行为）。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. staging 启动含 acp-network profile 的 dsh 实例；若组合供给 llm-pi-ai 数组节，执行 SMOKE-acp-network-07（默认 staging 组合无数组供给时按 skip 语义记录，永不报 PASS）。
3. 冲突矩阵验证（双形式同供、重复路由键、缺路由键、非法条目）以独立启动进程记录加载失败诊断；数组+settings 合并冲突验证诊断与路由集保持语义。
4. 回归 SMOKE-acp-network-01..06 与 S03/S49/S50/S51/S52 面。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile；本变更零新增持久化数据，回滚无迁移。
- **回滚须同时还原组合 patch 中的 llm-pi-ai 数组节**：旧构建的配置 schema 拒绝数组形式，带着数组节回滚会在加载期失败；该注意项写入升级指南。
- 回滚后数组组合不可用，dict 组合与单路由部署不受影响；已注册路由行为与回滚前一致。
- 部署后检查：数组组合路由注册与 configOptions 分组广告、跨供应商切换命中与 resume 持久、冲突诊断指名、SMOKE-acp-network-01..06 既有回归保持。
```

# delta — acp-network-deployment-plan.md（变更 dsh-acp-multi-provider）

## ADDED — 多供应商路由供给发布（S53）

在「会话压缩入口发布（S52）」一节之后追加：

```markdown
## 多供应商路由供给发布（S53）

- 发布物包含 llm-pi-ai 配置双形态与归一化；acp-network 包零代码变化——端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- dspm 部署指引：在其 profile patch 增加 llm-pi-ai `providers` 节（数组形式：路由键 + apiKeyEnv + baseURL，或既有 dict 形式），保留 acp-network 行的 `provider` / `model` 值对为默认路由；apiKeyEnv 引用的凭据经凭据存储或环境变量供给。同实例由此服务多供应商，切换经 `set_config_option`（既有协议面）。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加多供应商面验证：
  1. 数组组合（两个本地 mock 供应商路由）启动，`session/new` 核对 configOptions 两供应商分组与默认路由。
  2. `set_config_option` 切换到另一供应商模型 → prompt 往返命中被切换路由（mock 后端记录）；断开重连 `session/resume` 后选择保持。
  3. 冲突组合（数组与 dict 同供）独立进程启动，记录加载失败指名诊断。
  4. 回归既有 prompt/resume、审批策略（S49）、技能枚举（S50）、计划模式（S51）、压缩面（S52）与 `/compact` 命令路径。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret），另加组合 patch 还原注意（见 core-01 §十五：旧构建拒绝数组形式配置）；零持久化数据，回滚无迁移。
- relay 侧（dspm）零新语义：配置面变化对协议帧透明；dspm 客户端无需新增 capability 声明或方法。
```

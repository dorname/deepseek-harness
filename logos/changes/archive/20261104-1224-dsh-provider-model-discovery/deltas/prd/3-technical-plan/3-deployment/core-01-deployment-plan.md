# delta — core-01-deployment-plan.md（变更 dsh-provider-model-discovery）

## ADDED — 十、DeepSeek 动态模型目录发布（S48）

### 发布物与前置检查

- 发布物为包含 `llm`、`llm-deepseek`、`llm-deepseek-api-key`、`acp` 及对应文档变更的新 dsh 版本或镜像，部署记录必须包含精确 commit；本地源码修改不构成 dspm 可消费交付。
- 构建前确认受影响单元、真实 Loader 组合、ACP 集成、keyless 快照和聚焦 coverage 通过；真实 API e2e 与部署后 smoke 分别记录，不得用 Mock 结果替代 AC-6。
- 发布包含 `docs/upgrade-guide/v0.2.1-alpha.1/deepseek-dynamic-model-discovery/` 中英文指南，说明默认目录改为网络发现、显式 `models` 人工覆盖、发现错误传播和 ACP 不再补回未列出当前模型。

### 配置与凭据

- 不新增 Secret 渠道。继续通过当前 `apiKeyEnv`、credentials 服务或既有进程环境解析 API key；`DEEPSEEK_BASE_URL` 只在既有可信 launch environment 路径生效，密钥不得写入 cordis.yml、日志、缓存键、部署报告或仓库。
- 未配置 `models` 的 API-key 路由升级后开始访问解析后端点的模型列表 URL。默认 `discoveryTimeoutMs=10000`、`discoveryCacheTtlMs=30000`；部署可按端点能力显式调整，TTL 0 只关闭完成结果复用。
- 不支持模型列表接口或必须离线运行的部署，应在升级前显式配置人工 `models`；`models: []` 表示明确空目录。动态发现失败不会自动读取该人工配置，配置来源必须清楚固定。
- 无数据库或 Session 格式迁移；既有 `provider/model` 字符串保持不变。

### staging 部署步骤

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. 在 staging 使用既有 Secret 与目标 `baseURL` 启动 dsh ACP/headless 组合，不启用 dspm 静态 `profile_patch` 模型清单作为替代实现。
3. 检查启动日志无密钥和阻断性错误；读取动态目录，确认只包含上游真实 ID，失败和成功空目录不被静态项伪装。
4. 执行 SMOKE-core-25：目录包含 `deepseek-v4-flash` 时选择该精确 ID 完成真实推理，再验证另一个实际目录模型；第二模型权限失败须如实记录。
5. 写入部署报告与结果后才标记部署完成；若真实凭据、端点或模型权限不可用，不得把相应真实验收标为 PASS。

### 回滚与部署后检查

- 回滚到上一版 dsh 发布物并重启对应 profile，恢复上一版 provider/ACP 行为；不得通过 dspm 预写静态模型清单制造回滚成功假象。
- 回滚不迁移或删除会话数据。动态选择的模型 ID 已按既有字符串持久化；旧版能否继续推理取决于其配置与上游支持，部署报告须记录该兼容性事实。
- 部署后检查动态目录新增/移除在 TTL 后可见、失败可重试、ACP 不补回失效模型、最终请求使用精确 ID，并保留 SMOKE-core-06 与 ACP 网络既有冒烟回归。

## MODIFIED — 十、DeepSeek 动态模型目录发布（S48）· staging 部署步骤（第 4 步）

1. 记录上一版可回滚发布物与 commit，构建并标识新版本或镜像。
2. 在 staging 使用既有 Secret 与目标 `baseURL` 启动 dsh ACP/headless 组合，不启用 dspm 静态 `profile_patch` 模型清单作为替代实现。
3. 检查启动日志无密钥和阻断性错误；读取动态目录，确认只包含上游真实 ID，失败和成功空目录不被静态项伪装。
4. 执行 SMOKE-core-25：选择目录中的实际模型完成真实推理（`deepseek-v4-flash` 在目录时优先选择该精确 ID，缺席时如实记录缺席并改选实际模型），再验证另一个实际目录模型；第二模型权限失败须如实记录。
5. 写入部署报告与结果后才标记部署完成；若真实凭据、端点或模型权限不可用，不得把相应真实验收标为 PASS。

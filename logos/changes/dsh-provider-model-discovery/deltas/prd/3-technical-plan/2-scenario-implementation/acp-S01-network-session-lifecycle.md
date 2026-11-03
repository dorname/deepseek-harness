# delta — acp-S01-network-session-lifecycle.md（变更 dsh-provider-model-discovery）

## ADDED — 动态模型目录衔接（S48）

S48 复用本场景的连接、认证和会话生命周期，不新增网络 ACP 方法。首次 `session/new` 与持久化 `session/resume` 在既有响应构建阶段读取模型目录并填充 `configOptions`：

1. bridge 完成 agent/session 准备后，model control 通过 `llm.listModels(provider, signal)` 获取当前动态或人工覆盖目录。
2. 成功目录按原样模型 ID 生成 choices/options；成功空目录生成空 options。已持久化但不在目录中的模型可保留 currentValue，不补入 options。
3. 任一必需目录发现失败时，`session/new`/`resume` 返回 JSON-RPC error 并执行既有会话资源回滚，不返回静态目录或伪正常空组。
4. `session/set_config_option` 重新遵守同一缓存规则构建 choices，只接受目录内值；后继 options 构建成功后才提交选择。失败不改变既有选择。
5. 已建立会话的 prompt 继续使用已提交的精确模型 ID；后台或独立目录读取失败不强制取消纯推理，后续显式目录操作仍返回真实结果或错误。

对应覆盖：UT-S48-06、UT-S48-07、ST-S48-01、ST-S48-02，并复用 ST-S03-01、ST-S03-02、ST-S26-01 验证既有会话与取消行为。

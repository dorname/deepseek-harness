# delta — core-01-feature-design.md（变更 dsh-provider-model-discovery）

## MODIFIED — 1.4 SDK / ACP 结构

- SDK 协议：newline-delimited JSON-RPC over stdio（`dsh-sdk-protocol`）；会话/事件/通知类型化（`dsh-sdk-client`、`dsh-sdk-jsonrpc-server`）。
- ACP：Agent Client Protocol 的 automation-only 子集（`dsh-acp`）。模型目录继续经 `session/new`、`session/resume` 与 `session/set_config_option` 的既有 `configOptions` 发布；目录发现错误经既有 JSON-RPC 错误返回，不新增 ACP 方法、字段或静态兜底目录。
- Python：`DeepSeekHarness`（高层 turns API）+ `HarnessClient`（低层 RPC）。

## ADDED — 8. 动态模型目录交互规格（S48）

### S48: DeepSeek 动态目录 — 配置与调用规格

**配置**：`llm-deepseek-api-key` 未配置 `models` 时从解析后的 `baseURL` 动态发现；显式 `models` 数组是人工覆盖，`models: []` 是明确的空目录。新增 `discoveryTimeoutMs`（默认 10000 ms，有限正整数）与 `discoveryCacheTtlMs`（默认 30000 ms，非负整数）；TTL 为 0 只禁用完成结果复用，不禁用并发请求合并。端点优先级保持显式 `baseURL` → 可信 `DEEPSEEK_BASE_URL` → `PUBLIC_BASE_URL`，人工覆盖与动态发现不得因失败互相自动切换。

**内部接口**：`LlmRuntime.listModels(provider, signal?)` 与对应 adapter/discovery 调用传递可选 `AbortSignal`。该变更不新增模型可见输入、Session 事件、ACP 方法或 TypeScript/Python SDK 会话接口；如实现触及 agent-loop 或 `SessionEventMap`，必须在同一切片补充双 SDK expected outputs。

### 发现与解析

- 列表 URL 由 baseURL 去除末尾斜杠后构造：路径已以 `/v1` 结尾时追加 `/models`，否则追加 `/v1/models`；保留网关路径前缀，推理 baseURL 不变。
- 请求为 `GET`，使用当前路由 credentials-first 凭据解析结果，发送 `x-api-key`、`anthropic-version: 2023-06-01` 与既有 attribution headers；禁止凭据重定向，不把密钥写入 URL、日志、错误或缓存键。
- 超时覆盖响应头与正文读取；固定 4 MiB 安全上限同时检查声明长度和实际累计字节。响应只接受顶层 `data` 数组；条目须有非空字符串 `id`，名称依次取非空 `name`、`display_name`、`displayName`，否则用 ID。跳过畸形条目，按 ID 首次出现去重并保持上游顺序。
- 返回 `provider/id/name` 所需目录信息，不编造 modalities、context window、token limits 或描述。成功空数组是空目录，不是错误，也不是静态回退条件。

### 缓存、取消与释放

- 进程内缓存只保存成功结果（包括空数组），失败不立即可用缓存。缓存键包含 provider 路由、解析后端点、协议、凭据引用、发现设置和凭据代际或不可逆指纹；原始 API key 不得成为键或日志内容。
- 相同键的并发 miss 合并为一个上游操作。每个调用方独立响应取消；最后一个等待者取消后中止共享传输。插件 dispose 使缓存失效、中止并等待在途操作完成，不允许卸载后的迟到结果重新发布。
- 新会话与设置前 choices 构建使用同一缓存和失效规则；已有空闲会话不后台轮询。只有 TTL 到期、配置或凭据代际变化才触发新的上游发现，本场景不新增主动 `config_option_update`。

### ACP options 与模型切换

- ACP 不再逐 provider 吞掉 `listModels` 错误并返回空组；options 操作任一必需目录失败即经既有 JSON-RPC 错误失败，`session/new`/`resume` 沿用既有资源回滚。
- 成功空目录发布 `options: []`。当前已选模型不在目录时，可继续作为 `currentValue` 表示会话状态，但不得注入 choices/options，也不得因此通过设置校验。
- `session/set_config_option` 只接受本次构建的动态或人工覆盖 choices。模型/reasoning 变更先计算并刷新完整后继状态，成功后再提交选择；失败不得留下部分选择变更。
- 目录读取失败不主动取消已有会话的纯推理；后续显式目录操作仍必须返回真实目录或错误。

### 验收条件（交互级）

##### 正常：动态值贯通
- **GIVEN** 可控端点返回精确模型 ID
- **WHEN** 客户端创建会话、选择模型并 prompt
- **THEN** `configOptions`、设置值、持久化模型与上游请求 ID 一致
##### 异常：目录不可用与空目录可区分
- **GIVEN** 一次发现失败和一次成功空 `data`
- **WHEN** 分别创建会话或刷新 options
- **THEN** 前者返回显式错误且不创建静态 choices，后者成功返回空 options；后续成功重试可恢复目录
##### 正常：上游移除当前模型
- **GIVEN** 当前模型不在刷新后的目录
- **WHEN** 客户端读取 options 或尝试再次选择旧值
- **THEN** options 不含旧值，currentValue 可保留旧状态，设置旧值被拒绝，历史会话显示不丢失
##### 回归：无新增客户端表面
- **GIVEN** 既有 ACP、dspm 与 SDK 消费方
- **WHEN** 使用原有方法、字段和 `provider/model` 标识
- **THEN** 无需新增前端或 dspm 静态清单即可消费动态目录；数据库结构、会话格式和模型可见事件不变

# delta — core-system-map.md（变更 dsh-provider-model-discovery）

## ADDED — 13. DeepSeek 动态模型目录（S48）

### 13.1 组件与职责

| 组件 | 位置 | 职责 |
|------|------|------|
| DeepSeek API-key 配置解析 | `packages/llm/llm-deepseek-api-key/src/config.ts` | 区分省略 `models` 的动态发现与显式人工覆盖；验证 `discoveryTimeoutMs`、`discoveryCacheTtlMs`，沿用既有端点与凭据引用解析 |
| DeepSeek 共享配置与 URL | `packages/llm/llm-deepseek/src/config.ts`、`messages-api.ts` | 复用 models schema 与保留路径前缀的 Messages API root；不为 API-key 动态目录提供静态默认项 |
| 动态发现器 | `packages/llm/llm-deepseek-api-key/src/discovery.ts` | 凭据解析、有限 HTTP 读取、响应校验、精确 ID 目录、成功缓存、singleflight、等待者取消与 dispose 静默 |
| LLM Service Definition / Runtime | `packages/llm/llm/src/index.ts` | `listModels(provider, signal?)` 将可选取消信号传到 provider adapter；不改变其他 provider 的目录语义 |
| DeepSeek adapter | `packages/llm/llm-deepseek/src/{types,adapter,host}.ts` | 在动态发现回调与共享推理适配器之间传递取消信号和原样模型目录；最终请求模型字段不做别名改写 |
| ACP model control | `packages/acp/acp/src/model-control.ts` | 以同一目录构建和校验 `configOptions`；传播发现错误，保留未列出 currentValue 但不补 choices，原子提交选择变更 |

### 13.2 发现数据流

```text
ACP / other LLM consumer
  │ listModels(provider, signal)
  ▼
DeepSeek API-key route ── explicit models ──▶ manual catalog (including explicit empty)
  │ omitted models
  ▼
resolved baseURL + protocol + credential reference + discovery settings
  │ successful cache hit
  ├──────────────────────────────────────────▶ exact catalog
  │ miss / expired / credential generation changed
  ▼
singleflight discovery ──▶ GET Anthropic-compatible models endpoint
  │                                      ├─ success: validate → deduplicate → cache → exact catalog
  │                                      ├─ success empty data: cache → empty catalog
  │                                      └─ failure: classified error; no cache or static fallback
  ▼
ACP configOptions / session/set_config_option / persisted provider/model / inference request
```

缓存是进程内易失状态，不写入 Session、数据库或配置。缓存键不包含原始密钥；凭据轮换通过代际或进程随机盐保护的不可逆指纹隔离。模型目录不是模型可见会话输入，因此不新增 `SessionEventMap` 成员；动态选择仍由既有 ACP 状态与 `provider/model` 持久化路径记录。

### 13.3 故障与生命周期不变量

- 目录失败不得由 `DEFAULT_MODELS`、历史目录或当前模型伪装为成功；失败不缓存，成功空数组可以作为成功结果缓存。
- 超时同时约束响应头和正文，正文累计字节固定不超过 4 MiB；网络、HTTP、JSON、结构、凭据、超时和调用方取消保持可区分，错误不携带密钥或上游响应正文。
- singleflight 只共享底层传输，不共享等待者取消状态；插件 dispose 中止并等待传输结束，迟到结果不得重新填入已释放缓存。
- ACP 目录操作失败沿用 `session/new`/`resume` 回滚，不强制中断已有纯推理；模型选择只有在后继 options 状态完整构建成功后提交。
- 产品可见组合必须通过真实 Loader 配置和可控 HTTP 端点验证动态目录及最终精确模型请求；单元手工 Context 不能替代该证据。

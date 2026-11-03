# core S48: 按供应商 baseURL 动态发现 DeepSeek 模型目录（场景实现）

> 来源：变更 `dsh-provider-model-discovery`。场景定义见 `core-01-requirements.md` §S48；交互规格见 `core-01-feature-design.md` §8。

## 1. 参与者

| 参与者 | 职责 |
|---|---|
| ACP / 其他 LLM 消费方 | 请求目录、传递可选取消信号、选择精确模型 ID |
| `LlmRuntime` / DeepSeek adapter | 将目录请求和取消信号路由到 `deepseek-official` |
| API-key 配置解析器 | 固定同一次操作使用的 baseURL、模型来源、凭据引用和发现设置 |
| 动态发现器 | 成功缓存、singleflight、有限 HTTP、响应校验、取消与释放 |
| credentials / launch environment | 按既有 credentials-first 规则提供当前凭据，不暴露给 ACP 或缓存键 |
| 模型供应商 | 返回真实模型目录并接收最终原样模型 ID 的推理请求 |

## 2. 配置与 URL 解析

1. 每次目录操作先解析当前配置。省略 `models` 进入动态发现；显式数组（包括空数组）直接进入人工覆盖，不请求网络，也不得在动态失败后自动启用。
2. 动态模式沿用显式 `baseURL` → 可信 `DEEPSEEK_BASE_URL` → `PUBLIC_BASE_URL`。未显式配置 baseURL 时对公共端点动态发现，不返回内置目录。
3. baseURL 去除末尾斜杠；URL pathname 已以 `/v1` 结尾时追加 `/models`，否则追加 `/v1/models`。不得用根路径替换方式丢失 `/anthropic` 或网关前缀。
4. 请求使用当前路由凭据，发送 `x-api-key`、`anthropic-version: 2023-06-01`、accept 与既有 attribution headers，禁止重定向。默认发现超时 10000 ms，成功缓存 TTL 默认 30000 ms；TTL 0 不禁用 singleflight。

## 3. 主路径时序

```mermaid
sequenceDiagram
  participant C as ACP / LLM consumer
  participant R as DeepSeek API-key route
  participant D as Discovery cache/singleflight
  participant S as Credentials
  participant P as Provider endpoint

  C->>R: listModels(deepseek-official, signal)
  R->>R: resolve current connection and models source
  alt explicit models override
    R-->>C: configured catalog (including explicit empty)
  else dynamic discovery
    R->>D: get(route, endpoint, credential ref, settings, signal)
    D->>S: resolve current API key
    S-->>D: secret or classified credential error
    alt successful unexpired cache entry for current credential generation
      D-->>C: detached exact catalog, including cached empty
    else miss / expired / configuration or credential generation changed
      D->>P: GET models; timeout + caller cancellation + 4 MiB bound
      alt another waiter shares the same operation
        C->>D: independent waiter joins existing transport
      end
      alt 2xx and valid top-level data array
        P-->>D: model entries
        D->>D: exact IDs; label precedence; first-wins dedupe; cache success
        D-->>C: exact catalog or successful empty catalog
      else transport / HTTP / timeout / size / JSON / schema failure
        P-->>D: failure or invalid response
        D-->>C: classified error; no failure cache; no static fallback
      end
    end
  end
```

返回给各等待者的目录不得共享可变数组或条目。只缓存成功结果；失败后的下一次调用可立即重试。缓存键不得包含原始密钥，端点、协议、凭据引用、发现设置或凭据代际变化不得复用旧目录。

## 4. 上游刷新与 ACP 模型切换

```mermaid
sequenceDiagram
  participant P as Provider
  participant D as Discovery
  participant A as ACP ModelControl
  participant H as Session / adapter

  Note over P,D: first successful catalog A/B; cache expires
  P-->>D: refreshed catalog B/C
  D-->>A: B/C only
  A->>A: build configOptions; do not reinsert current A
  A-->>A: currentValue may remain A; choices/options contain B/C
  A->>D: set_config_option(model, C)
  D-->>A: current B/C choices
  A->>A: construct complete successor state
  alt options construction succeeds
    A->>H: commit selected provider/model = C
    A-->>A: publish updated configOptions
  else successor construction fails
    A-->>A: reject; keep previous selected state
  end
  A->>H: prompt with selected C
  H->>P: inference request model = exact C ID
```

`session/set_config_option` 拒绝 A 或其他不在当前目录中的值。当前模型被移除不会抹掉历史会话状态，但也不能重新成为可选值。新建与恢复会话的 options 失败沿用既有回滚；目录刷新失败不主动取消已有纯推理。

## 5. 响应、错误与安全

- 仅接受顶层 `data` 数组；每项读取非空字符串 `id`，名称依次取 `name`、`display_name`、`displayName`，再回退 ID。畸形条目跳过，同 ID 首次出现保留；整个响应缺少数组或 JSON 非法则报错。
- 成功空 `data` 返回并缓存空目录。不得合并内置模型、上次静态配置或当前模型，不编造 modalities、context window、maxTokens 或描述。
- 固定 4 MiB 上限覆盖 Content-Length 预检和实际累计读取；超时覆盖响应头与正文。分别保留缺失凭据、调用方取消、发现超时、网络/HTTP 状态、过大、非法 JSON 和非法结构错误。
- 错误可含 provider、脱敏端点、HTTP 状态和分类，不含 API key、认证头、上游响应正文或内部堆栈。日志不得记录原始密钥。

## 6. 并发取消与插件释放

1. 相同缓存键的并发 miss 只创建一个共享传输，每个 waiter 持有独立取消登记。
2. 单个 waiter 取消只拒绝自己的等待，不中止仍有其他 waiter 的传输；最后一个 waiter 取消时中止共享传输。
3. 已 abort 的传输不得写入成功缓存。新操作不得删除或覆盖后来创建的同键条目，清理由操作身份保护。
4. 插件 dispose 使缓存不可用，中止全部在途传输并等待它们静默结束；dispose 后的迟到结果不得发布或复活缓存。
5. 产品可见行为须用真实 Loader 组合与可控 HTTP 端点验证，不能仅用手工 Context 单元测试代替。

## 7. 验收条件映射

| AC | 覆盖测试 |
|---|---|
| S48-AC 动态目录、精确解析与无编造元数据 | UT-S48-01、ST-S48-01 |
| S48-AC URL、认证、密钥脱敏 | UT-S48-02 |
| S48-AC TTL、配置/凭据失效、singleflight、只缓存成功 | UT-S48-03 |
| S48-AC 超时、独立取消、4 MiB 与 dispose | UT-S48-04 |
| S48-AC 错误分类、空目录与失败重试 | UT-S48-05、UT-S48-06、ST-S48-02 |
| S48-AC ACP 刷新、移除当前模型、原子切换与精确请求 ID | UT-S48-06、UT-S48-07、ST-S48-01 |
| S48-AC 真实供应商推理 | SMOKE-core-25；无真实凭据时不得记为已覆盖 |
| S03/S20/S26 回归 | ST-S03-01、ST-S03-02、ST-S20-01、ST-S20-02、ST-S20-03、ST-S26-01 |

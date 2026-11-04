# delta — acp-network-system-map.md（变更 dsh-provider-model-discovery）

## ADDED — 动态模型目录与错误传播（S48）

网络 ACP 与 stdio ACP 共用 `AcpBridge` 的模型控制实现，因此动态目录不需要新增网络路由、ACP 方法或 dspm 侧协议复制。`session/new`、`session/resume` 和 `session/set_config_option` 在既有响应中携带由 `llm.listModels` 构建的 `configOptions`；目录错误经既有 JSON-RPC error 返回。

```text
Client                         AcpBridge / ModelControl              DeepSeek route
  │ session/new|resume|set_config_option        │                         │
  │────────────────────────────────────────────▶│ listModels(signal)      │
  │                                             │────────────────────────▶│
  │                                             │                         │ cache / GET models
  │                                             │◀── exact catalog/error ─│
  │◀── configOptions or JSON-RPC error ─────────│                         │
```

- 任一必需 provider 目录失败不得被转换为正常空组；新建或恢复会话在 options 构建失败时沿用既有回滚。
- 成功空目录保持 `options: []`；未列出的当前模型只可作为 `currentValue` 描述历史状态，不进入 choices/options，设置校验使用同一份目录。
- 客户端取消只取消自己的目录等待；并发客户端可共享底层发现，最后一个等待者取消才中止共享传输。连接或 bridge 释放不得留下可重新发布结果的发现任务。
- 既有网络认证、连接隔离和会话持久化机制不变；API key 仍只由 DeepSeek 路由的 credentials-first 路径解析，不经过 ACP 网络报文或 dspm 配置复制。

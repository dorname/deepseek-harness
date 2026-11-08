# delta — acp-network-system-map.md（变更 dsh-acp-multi-provider）

## ADDED — 默认路由选择与多路由广告语义（S53）

在「会话压缩方法面（S52）」一节之后追加：

```markdown
## 默认路由选择与多路由广告语义（S53）

本变更对网络 ACP 协议面零改动；本节补记模型选择面与多路由供给的关系，供部署方对照。

```text
│ 部署 patch（组合配置）              │ llm-pi-ai                       │ acp-network / bridge              │ ACP client (dspm)
│ providers 数组节（路由 A/B）──────▶ │ 归一化 → 注册路由 A/B            │ session/new：provider/model 值对  │
│ provider/model 值对（默认路由）───▶ │（acp-network Config 原样透传）   │ 选定会话起点路由                  │ ◀── configOptions 按供应商分组广告 A/B
│                                    │                                 │ set_config_option 切换 ────────── │ ◀── EpochHeader 持久，resume 恢复
```

- `provider` / `model` 值对语义：会话起点的默认路由选择，不是能力边界——协议面把全部已注册路由按供应商分组广告为 `set_config_option` 模型选项，选择经 EpochHeader 持久、resume 恢复。
- 多路由供给经 llm-pi-ai 配置面完成（数组或 dict），对网络面透明：bridge 与 model-control 只消费 llm 注册表，不需要新增装配、路由或协议帧。
- 值对指向未注册路由时会话创建 fail-loud（既有行为）。
- dspm 部署指引：profile patch 增加 llm-pi-ai `providers` 节（数组或 dict，各自 apiKeyEnv / baseURL），保留 acp-network 行的 `provider` / `model` 值对为默认路由；apiKeyEnv 引用的凭据经凭据存储或环境供给（既有每请求解析，键不入配置）。
```

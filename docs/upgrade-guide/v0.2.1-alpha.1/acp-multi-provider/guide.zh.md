---
kind: upgrade-guide
description: "llm-pi-ai 组合可以以 providerList 数组声明供应商路由——settings 可编辑 providers dict 之外的仅组合层部署工件，并带有加载期 fail-loud 冲突词表。"
---

# llm-pi-ai 的多供应商路由供给

[English](guide.md) | 中文

## 变更

`llm-pi-ai` 在既有 `providers` 字典之外新增第二个路由供给键：

- `providerList` 是数组，每项在 `provider` 字段点名路由，其余字段与 dict 值完全一致（`apiKeyEnv`、`baseURL`、`api`、`models`、`modelOverrides`、`compat`、`headers`、`retryPolicy` 等）。声明顺序即解析后的路由顺序，数组经与等价 dict 相同的管线归一化——注册、可配置目录、模型发现与凭据解析行为完全一致。
- `providers` 不变：volatile dict，键即路由名，可经 settings 文档（web Models 页）活编辑，由 settings 或组合两者之一供给。
- `providerList` 是仅组合层的部署工件。它不进 volatile 形态，settings 写入门拒绝它：只有 `cordis.yml` 或 profile patch 能声明或修改它，修改像普通组合变更一样重挂载条目。
- 冲突 fail-loud。两键同时点名路由 → 插件加载失败。数组内重复或空 `provider` 键 → 加载失败并点名数组条目。dict 值携带 `provider` 字段仍被拒绝。在组合供给的 `providerList` 之旁以 settings 写入 `providers` 会被拒绝并指名冲突，此前路由集继续服务。
- acp-network 无需变化：`provider` / `model` 值对仍是会话起点的默认路由选择，`configOptions` 按供应商分组广告全部已注册路由（既有行为）——注册路由越多，广告越宽。

## 迁移

1. 机器生成的 fleet 清单（一份工件表达全部路由）：在 `llm-pi-ai` 组合条目下以 `providerList` 声明路由：

   ```yaml
   - id: llm-pi-ai
     name: '@deepseek-ai/dsh-llm-pi-ai'
     config:
       providerList:
         - provider: openai
           apiKeyEnv: OPENAI_API_KEY
         - provider: acme-gateway
           apiKeyEnv: ACME_GATEWAY_API_KEY
           api: openai-completions
           baseURL: https://gateway.acme.example/v1
           models:
             - id: acme-large
   ```

2. 用户活编辑的路由保留 `providers` dict；web Models 页与 settings 文档不变。规则：settings 用 dict，组合层两键皆可，一份部署二选一。
3. 同一组合绝不两键同供——加载失败会点名两键。手编 profile patch 会整体替换条目的 `config`，因此 `cordis.yml` 中声明了 `providerList` 的条目，其 patch 行必须携带完整配置。
4. 回滚：旧 dsh 构建的 schema 拒绝 `providerList`，因此回滚发布物的同时要还原组合 patch 中的 `providerList` 节（或改写为 `providers` dict），再启动旧构建。
5. 确认：启动组合并核对已注册路由（`llm.listProviders()` 或会话 `configOptions` 广告）；对 `providerList` 的 settings 写入会以 `Config field "providerList" is not volatile` 被拒。

---
kind: upgrade-guide
description: "DeepSeek API-key 路由改为从端点动态发现模型目录；ACP 不再把被移除的模型重新插入选项。"
---

# DeepSeek 模型目录来自端点；ACP 不再把被移除的模型重新插入选项

[English](guide.md) | 中文

## 变更

在 `deepseek-official` API-key 路由（`@deepseek-ai/dsh-llm-deepseek-api-key`）上，此前省略 `models` 配置会公布静态目录 `deepseek-flash` + `deepseek-v4-pro`。下一版本改为从解析出的端点按 Messages 兼容的模型列表（`GET {messagesApiRoot}/models`）发现目录，使用与推理相同的端点与凭据解析。网关未实现该列表的部署，以及端点不可达的组合，现在目录读取（`ctx.llm.listModels`、设置与 ACP 模型选项）会以发现错误失败，而不是看到上游可能不存在的静态 id。每次发现受新增 `discoveryTimeoutMs`（默认 10 秒）约束；成功结果——包括空列表——按端点、凭据和发现配置缓存 `discoveryCacheTtlMs`（默认 30 秒；0 禁用复用）。失败永不缓存。显式 `models` 列表仍为人工覆盖，不访问网络；`models: []` 表示明确的空目录。

此前 ACP 会在提供方停止列出某模型后，把会话当前模型重新插入公布的选项，并吞掉逐 provider 的目录错误。下一版本按实时目录校验选项：被移除的当前模型仅保留为 `currentValue`，不再出现在选项中；`session/set_config_option` 拒绝未列出的值；目录发现错误向客户端传播。重新提交已保存选择的 ACP 客户端必须处理该拒绝。

## 迁移

1. 若网关未实现模型列表，或需要离线保留原目录，请在 `llm-deepseek` 条目上设置显式 `models` 列表；原默认列表的 id 为 `deepseek-flash` 和 `deepseek-v4-pro`。
2. 若端点已实现列表，保持 `models` 省略并确认凭据可达；目录读取随后跟随端点。
3. ACP 客户端：把 `options` 之外的 `currentValue` 视为只读状态，停止重新提交未列出的 id。
4. 确认：`ctx.llm.listModels('deepseek-official')` 显示端点的真实 id；端点不可达时目录读取以发现错误失败；显式 `models` 配置不访问网络即可提供所配置列表。

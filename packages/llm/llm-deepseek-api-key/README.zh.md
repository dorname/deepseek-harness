---
description: "DeepSeek API key authentication and model discovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek-api-key

[English](README.md) | 中文

## 概述

为 `deepseek-official` 注册独立的鉴权和模型发现插件。通过 [llm-deepseek](../llm-deepseek/README.zh.md) 共用 Messages 请求实现；本包拥有凭据解析和目录可用性判断。

鉴权解析将验证后的 API key 放入 `x-api-key`，供 Messages 和 Files 请求共同使用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

`apiKeyEnv` 默认为 `DEEPSEEK_API_KEY`，在每次请求时解析凭据。已组合 credentials 服务时，按其优先级解析；只有未组合该服务时才直接读取启动环境。请求时凭据缺失以 `MISSING_CREDENTIAL` 失败；格式错误以 `INVALID_CREDENTIAL` 失败。目录发现走同一凭据解析路径，凭据不可用时以相同错误失败。

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    reasoningEffort: high
    apiKeyEnv: DEEPSEEK_API_KEY
```

端点和凭据引用来自同一次配置解析；进行中的请求保留该快照，后续配置更新仅影响后续请求。账号登录态不影响该路由使用的凭据。

省略 `models` 时，从解析出的端点按与推理相同的端点与凭据解析路径发现 Messages 兼容模型列表；发现的 ID 原样保留，不虚构能力元数据。显式 `models` 列表为人工覆盖，不访问网络也不解析凭据（`[]` 表示明确的空目录）。每次发现受 `discoveryTimeoutMs`（默认 10 秒）约束；成功结果（包括空列表）按端点、凭据和发现配置缓存 `discoveryCacheTtlMs`（默认 30 秒；0 禁用复用，并发调用仍合并）。失败永不缓存：错误向目录消费方传播，无静态回退。设置命名空间采用 Cordis entry id，没有 entry 时采用插件名。产品保留 official 的 `llm-deepseek` entry id，账号使用 `llm-deepseek-account`。

<a id="understand-the-implementation"></a>
## 理解实现

注册和监听随插件生命周期释放。共享 Host 绑定提供附件访问、请求扩展、匿名标识和重试策略的原子更新；本包只注册自己的路由。

<a id="further-exploration"></a>
## 进一步探索

[LLM streaming](../../../docs/subsystems/llm-streaming.zh.md) · [Messages](../llm-deepseek/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### 已鉴权的模型请求

#### What the model sees

`deepseek-official` 请求不包含本插件添加的模型可见文本；请求由共享 Messages 传输序列化。

#### Token effect

鉴权和目录发现不增加输入 token；实际调用的 token 由所选模型与请求内容决定。

#### KV Cache effect

凭据与目录可用性不进入模型输入；协议传输拥有请求前缀的序列化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 目录是配置元数据，不验证远端是否接受模型；实际调用仍可能失败。
- 端点发现要求网关实现 Messages 兼容的模型列表；未实现的网关需要显式 `models` 覆盖（[迁移指南](../../../docs/upgrade-guide/v0.2.1-alpha.1/deepseek-dynamic-model-discovery/guide.zh.md)）。

<a id="dev-note"></a>
### 开发备注

注册与鉴权的测试也覆盖共享传输包中的 Loader 组合场景。

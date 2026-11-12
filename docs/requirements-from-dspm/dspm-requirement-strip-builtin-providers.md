# dspm → dsh 需求：镜像裁掉内置供应商列表（provider 为唯一模型来源）

- 来源：dspm 平台组（dorname），2026-11-09
- 状态：需求提出，待 dsh 侧评估立项
- 关联：dspm 长期设计 `skill-output/dspm-agent-platform-design.md`；dspm 合同 grp-20261109091635（AI 助手集成组）D10

## 背景

dspm 已上线多供应商池：per-provider 补丁经 ConfigMap（`cordis.patch.yml`）下发 `llm-pi-ai.providers` dict（`api/baseURL/apiKeyEnv/models`）+ `PROVIDER_<ID>_API_KEY/_BASE_URL` env（SecretKeyRef），`acp-network` 的默认 `provider/model` 也由该补丁钉到解析后的供应商。供应商解析三级：用户绑定 → 全局激活 → （将移除的）静态兜底。

当前部署镜像 `dsh-acp-network-staging:v0.2.2-alpha.1`（源码 HEAD ee36c6f2 构建）的内置 profile 仍携带静态 `providerList`（deepseek-official 等）与内置默认 provider/model。由此产生两个问题：

1. dsh 目录（ACP configOptions → dspm ListModels → 前端模型选择器）中出现非用户配置的内置供应商条目（如 deepseek-official/kimi-for-coding），干扰「供应商池为唯一模型来源」的产品语义；
2. dspm 即将移除静态兜底凭据（`DEEPSEEK_API_KEY/DEEPSEEK_BASE_URL` env 与 agent.yaml 静态补丁中的 provider/model 钉死），内置路由会变成「可见但无凭据」的死条目。

## 需求

| # | 需求 | 判据 |
| --- | --- | --- |
| R1 | 镜像/主线裁掉内置 profile 的静态 `providerList`（清空或移除）；运行时供应商来源仅外部补丁（`llm-pi-ai.providers` dict 或后续形态） | 全新 home（无补丁）实例的目录不含任何内置供应商条目 |
| R2 | `acp-network` 在无外部 provider/model 补丁时不得回落内置默认；无供应商配置 = 无模型路由（session/new 返回空目录或明确错误，语义由 dsh 定并文档化） | 无补丁实例发起 prompt 得到明确「未配置模型供应商」类错误，不静默指向内置供应商 |
| R3 | 外部补丁兼容性不变：`providers` dict 字段（`api/baseURL/apiKeyEnv/models`）与 `acp-network` 的 `provider/model/transport/path/secret/audience` 语义保持；目录发现（discovery，GET `{baseURL}/v1/models` + `x-api-key`）行为与现状一致 | dspm per-provider 补丁在裁剪后镜像上行为不变（既有 UT/真机判据沿用） |
| R4（可选） | 若 `providers` dict 支持目录自动发现补全 `models`（发现结果合并/覆盖静态 models 清单），请明确优先级语义并文档化 | 文档描述发现与静态清单合并规则 |

## dspm 侧配套（同窗口实施，不依赖 R1/R2 交付）

- `agent.yaml` 静态基线补丁去掉 `provider/model` 钉死（保留 HMAC `secret/audience` 与 `llm-deepseek.maxTokens` 继承源）；
- `dsh-agent-secrets` Secret 移除 `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` 两键（保留 `DSH_ACP_NETWORK_SECRET`）；
- 效果：在 R1/R2 交付前，内置供应商条目将因无凭据不可用（dsh 目录仍可能列出）；R1/R2 交付后目录彻底干净。

## 验收

1. dspm 侧：仅含 per-provider 补丁的实例，目录/默认值/推理全部来自该供应商；
2. dsh 侧（R1/R2）：无补丁实例目录为空或明确错误；有补丁实例行为与现状一致；
3. 双方联调：无供应商用户获得清晰不可用语义，不出现内置供应商残影。

## 兼容性与风险

- dspm k8s 形态镜像版本化钉版（`image_pull_policy: Never`，本地构建），升级窗口双方协同；
- 存量 per-user home PVC 中已写入的旧 profile 文件随实例重建刷新（init 容器覆盖），无迁移负担；
- 若 dsh 有其他消费方依赖内置 providerList，请反馈以便 dspm 评估过渡开关（如 `DSH_DISABLE_BUILTIN_PROVIDERS`）。

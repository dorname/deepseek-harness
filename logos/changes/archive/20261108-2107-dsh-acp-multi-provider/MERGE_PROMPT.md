# 合并指令

## 变更提案
- 提案名称：dsh-acp-multi-provider
- 提案目录：logos/changes/dsh-acp-multi-provider/

## 提案内容

# 变更提案：多供应商路由数组供给（llm-pi-ai 组合面双形态 + 默认路由选择）

> module: core | created: 2026-11-08

## 变更原因

dspm 经 ACP 集成 dsh，REQ-D3 指出 acp-network Config 仅接受单 provider/model 值对，要求支持 providers 数组（各自 baseURL / apiKey 环境引用 / 默认 model），经 `llm.listProviders()` 返回多组——目标是单实例服务多供应商，简化「每实例单 provider + 切换重排」的供给链。dsh 侧核验：llm 注册表天然多 provider，会话级跨供应商切换端到端可用（选择经 EpochHeader 持久、resume 恢复）；出货 base bundle 已挂载休眠的 llm-pi-ai 多供应商孪生，组合配置以 providers dict 供给即注册活路由——零代码路径已于回复文档 §4.3 交付。

本变更为该诉求的形态交付。按回复文档 §8 增补决策（2026-11-08），不再等待 dspm 对 dict 形态的表态，第二期直接排入 providers 数组方案，dict-vs-数组之辩降级为文档说明项。数组落点经核验确定为 llm-pi-ai 的组合配置面而非 acp-network Config：供应商路由词汇（apiKeyEnv 凭据引用、baseURL、协议、模型目录、compat、重试策略）归 provider 插件所有，acp-network 是 llm 注册表的消费者；llm-pi-ai 的路由供给与宿端闭包（凭据解析、attachments、fs 路径映射）深度绑定，消费者侧另立路由定义面需复刻整套宿端接线；且 llm-pi-ai 对数组形态与 profile 内 `provider` 字段的拒绝是两次显式决策（`resolveProfiles` 与 `rejectRemovedFields`），重新开放须落在词汇所有方并给出消费者证据——dspm 的部署 patch 诉求即该证据。dspm 在 acp-network Config 上要的数组形态，由其部署 patch 中相邻的 llm-pi-ai 数组节承载：同一工件、同一文件，供给面归位。

## 变更类型

接口级（组合配置面输入形态扩展；无协议面、无持久化面变更）

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的场景总览与核心场景详述；新增 S53，并关联 S03、S15、S49、S50、S51、S52。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 新增 §13 多供应商路由供给形态规格。
- 影响的业务场景：新增 S53「部署配置以数组形态供给多供应商路由」；回归既有 dict 组合、settings 文档活重配、单路由部署与 S03 ACP 会话、S15 压缩、S49 审批策略、S50 技能清单、S51 计划模式、S52 压缩面。
- 影响的技术架构：`core-system-map.md`（多供应商路由供给形态）与新增 `core-S53-acp-multi-provider.md`；`acp-network-system-map.md` 补记默认路由选择与多路由广告语义（协议面零改动）。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 与 `acp-network-deployment-plan.md` 的发布物、staging 验证与回滚注意（含组合 patch 还原项）。
- 影响的 API：`llm-pi-ai` 组合配置的 `providers` 节点接受两种形式——dict（现行：映射键即路由键，settings 文档唯一形式）与数组（新增：每项 `{ provider: <路由键>, apiKeyEnv?, baseURL?, api?, models?, modelOverrides?, compat?, headers?, retryPolicy?, … }`）。数组在配置解析入口归一化进既有 dict 管线，归一化后行为与手写等价 dict 逐项一致。冲突 fail-loud：双形式同供、数组内重复路由键、缺失或空路由键、非法档案条目加载期硬失败并指名路由与来源；数组形式与 settings 文档供给并存按既有冲突语义诊断并保持上一有效路由集。acp-network Config（provider/model 必选值对）不变，语义补记为会话起点的默认路由选择。
- 影响的 DB 表：无；零新增会话事件类型、零新增 wire 类型，`SessionEventMap` 不变，Session format 维持 4。
- 影响的编排测试：无。
- 影响的测试规格：新增 `logos/resources/test/core-S53-test-cases.md`；更新 `logos/resources/test/smoke/acp-network-smoke-test-cases.md`（SMOKE-acp-network-07）；复用既有 config / dynamic-config / loader-composition 单元用例与 S03、S49、S50、S51、S52 回归 ID。
- 实现期交付物：`llm-pi-ai` 中英文 README 与 JSDoc、base bundle cordis.patch.yml 休眠挂载注释、config-catalog 重生成（配置 schema 变化）、`docs/upgrade-guide/<发布版本>/acp-multi-provider/` 中英文升级指南条目（双形态定义、settings dict-only、冲突词表、dict-vs-数组选型说明、dspm 组合示例；版本号随发布期确定）。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费包含配置双形态的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付；其部署 patch 的数组节依赖新构建的配置 schema。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物。本变更零持久化数据，回滚无迁移；**回滚须同时还原组合 patch 中的数组节**——旧构建的配置 schema 拒绝数组形式，带着数组节回滚会在加载期失败。该注意项写入升级指南与部署方案。
- 是否需要 smoke：是
- smoke 要求：数组组合实例上验证多路由注册与 configOptions 分组广告、跨供应商切换命中、resume 持久、冲突组合加载期指名失败（SMOKE-acp-network-07；需本地数组组合与 mock 供应商后端，staging 默认组合无数组供给时按既有 skip 语义记录，不伪报）。

## 变更概述

1. **数组形态（组合层）**：`llm-pi-ai` 组合配置的 `providers` 节点接受 dict（现行）与数组（新增）两种形式；数组每项携带 `provider` 路由键字段，其余字段与 dict 值完全一致。`providers` 是 volatile 配置节点，有两条供给通道：组合配置（cordis.yml / profile patch，部署工件）与 settings 文档（运行时活编辑，web Models 页即此）——组合供给的变更经 `loader/volatile-update` 热提交，不重挂载。归一化在配置解析入口完成，此后全部既有管线不变——`resolveProfiles` 档案校验与目录解析、memoized 快照、`registerAdapter` 路由注册、`registerConfigurableProviders` 可配置目录、`registerModelDiscovery`、凭据每请求解析——归一化后的行为与手写等价 dict 逐项一致。settings 文档仍仅接受 dict：settings 的逐键合并与活重配语义只对映射成立，web Models 页机制不变；数组是部署工件的静态声明形式。组合供给（本变更交付的数组形态与既有的 dict 形态）是无 PVC、无 settings 导入的 headless fleet 部署的直接供给通道——这正对应 REQ-D3「一份部署工件表达全部路由」的诉求。
2. **冲突 fail-loud**：数组与 dict 双形式同供、数组内重复路由键、数组项缺失或空 `provider` 字段、数组项档案非法——加载期硬失败并指名路由与来源，不静默降级；数组形式与 settings 文档供给并存属运行时合并冲突，按既有冲突语义以诊断错误失败并保持上一有效路由集。dict 形式中 `provider` 字段仍被拒绝——守卫改为形态上下文感知：dict 值拒绝该字段（迁移守卫不变），数组项该字段即路由键。
3. **acp-network 零代码改动**：provider/model 必选值对语义不变——它是会话起点的默认路由选择；协议面已把全部已注册路由按供应商分组广告为 `set_config_option` 模型选项（model-control 聚合 `llm.listProviders()`），选择经 EpochHeader 持久、resume 恢复。REQ-D3 条目中的「默认 model」由该值对承载；值对指向未注册路由时会话创建 fail-loud（既有行为）。dict-vs-数组的长期选型说明（settings 用 dict、组合两者皆可）作为 §8 决策中的文档说明项交付于升级指南与 README。

模型可见 ⟺ 已记录不变：零新增会话事件、零新增 wire 类型、`SessionEventMap` 与 Session format 不变。

## 复用测试 ID

- 既有 config.spec / dynamic-config.spec / loader-composition.spec 用例 — 回归 dict 形式解析、settings 活重配与 HMR dispose 语义不变。
- UT-S49-01 / UT-S49-05 — 回归 configOptions 面与 resume 广告结构不变。
- UT-S50-01 / UT-S50-05、UT-S51-01..06、UT-S52-01..06 与 S15 既有压缩用例 — 回归审批策略、技能枚举、计划模式、压缩面与自有 UI 压缩通道不受配置面变化影响。
- ST-S03-01 / ST-S03-02 — 回归 ACP 主链路不受配置面变化影响。
- SMOKE-acp-network-01..06 — 保留既有六条网络冒烟回归。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S53-acp-multi-provider.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/prd/3-technical-plan/2-scenario-implementation/core-S53-acp-multi-provider.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S53-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/test/core-S53-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/smoke/acp-network-smoke-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-multi-provider/deltas/test/smoke/acp-network-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(dsh-acp-multi-provider): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive dsh-acp-multi-provider`。

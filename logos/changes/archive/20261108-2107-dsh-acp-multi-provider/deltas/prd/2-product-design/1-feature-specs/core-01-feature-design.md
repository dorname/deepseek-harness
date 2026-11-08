# delta — core-01-feature-design.md（变更 dsh-acp-multi-provider）

## ADDED — §13、多供应商路由供给形态规格（S53）

在 §12（会话压缩交互规格）之后追加：

```markdown
## 13. 多供应商路由供给形态规格（S53）

### S53: 部署配置以数组形态供给多供应商路由 — 配置面规格

**双形态定义**：`llm-pi-ai` 组合配置的 `providers` 节点接受两种形式。`providers` 是 volatile 配置节点，有两条供给通道——组合配置（cordis.yml / profile patch，变更经 `loader/volatile-update` 热提交不重挂载）与 settings 文档（运行时活编辑，web Models 页即此）。dict（现行）：映射键即路由键，是 settings 文档唯一形式——settings 的逐键合并与活重配只对映射成立。数组（新增，组合层形式）：每项为 `{ provider, ...供应商档案 }`，`provider` 为路由键，其余字段与 dict 值完全一致（apiKeyEnv 凭据引用、baseURL、api、models、modelOverrides、compat、headers、retryPolicy 等）；声明顺序即归一化后的路由顺序。

**归一化**：配置解析入口将数组折叠为 dict（键取每项 `provider` 字段），此后全部既有管线不变——`resolveProfiles` 档案校验与目录解析、memoized 快照、`registerAdapter` 路由注册、`registerConfigurableProviders` 可配置目录、`registerModelDiscovery`、凭据每请求解析。归一化后的行为与手写等价 dict 逐项一致。

**冲突 fail-loud 词表**（自包含冲突在加载期硬失败，消息指名路由与来源，不静默降级）：

- 数组与 dict 双形式同时供给；
- 数组内重复 `provider` 路由键；
- 数组项缺失或空 `provider` 字段；
- 数组项档案非法（沿用既有校验词表：空 baseURL、非法 headers、目录不可服务等，消息标注数组位置）。

数组形式与 settings 文档供给并存属运行时合并冲突（settings 无法对数组逐键合并）：按既有冲突语义以诊断错误失败、路由集保持上一有效集，不静默吞并。dict 形式中 `provider` 字段仍被拒绝——守卫改为形态上下文感知：dict 值拒绝该字段（迁移守卫不变），数组项该字段即路由键。

**acp-network 默认路由选择语义（不变）**：`provider` / `model` 必选值对是会话起点的默认路由选择；`session/new` / `session/resume` 的 configOptions 由 model-control 聚合 `llm.listProviders()` 按供应商分组广告全部已注册路由（选项值 `JSON.stringify([provider, model])`）；`set_config_option` 切换经 EpochHeader 持久、resume 恢复。REQ-D3 条目的「默认 model」由该值对承载；值对指向未注册路由时会话创建 fail-loud（既有行为，本变更不改）。

### 文档说明项：dict 与数组的选型

settings 文档用 dict（活重配与逐键合并只有映射可承载）；组合配置两者皆可——部署工件是静态声明，数组适合清单式生成的部署清单，dict 适合与 settings 同构的手写 patch；两者归一化后行为等价。此为 §8 增补决策中「dict-vs-数组之辩降级为文档说明项」的交付形态。

### 验收条件（交互级）

##### 正常：数组组合与 dict 组合等价
- **GIVEN** 同一路由集的数组与 dict 两种声明
- **WHEN** 加载并注册
- **THEN** 解析结果、目录条目、路由序与凭据解析逐项等价；configOptions 分组广告一致
##### 正常：跨供应商切换与持久
- **GIVEN** 数组组合实例上的两个供应商路由
- **WHEN** `set_config_option` 切换、prompt 往返、断开重连 resume
- **THEN** 请求命中被切换路由；resume 后选择保持
##### 异常：形态冲突 fail-loud
- **GIVEN** 冲突词表所列各场景
- **WHEN** 加载或运行时合并
- **THEN** 自包含冲突加载期指名失败；数组+settings 合并冲突诊断失败并保持上一有效路由集
##### 回归：既有供给语义不变
- **GIVEN** dict 组合、settings 活重配、单路由部署
- **WHEN** 既有回归集执行
- **THEN** 行为保持，configOptions 面与 resume 广告结构不变
```

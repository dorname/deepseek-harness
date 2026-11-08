# core S53（部署配置以数组形态供给多供应商路由）— 测试用例

> 来源：变更 `dsh-acp-multi-provider`。场景来源 `core-01-requirements.md` §S53；场景实现见 `core-S53-acp-multi-provider.md`。
> 本变更无新增 model/user-visible 会话面（configOptions 分组广告与切换为既有行为，数据源扩展不改变其结构），故不新增 keyless 会话快照；配置面行为由单元用例与真实 Loader 组合承载，部署面由 SMOKE-acp-network-07 承载。

## S53: 部署配置以数组形态供给多供应商路由

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S53-01 | 数组归一化等价性 | config schema + `resolveProfiles` | 同一路由集的数组与 dict 两种声明 | 分别解析并比较 | 归一化结果逐项等价（档案字段、目录条目、路由序）；声明顺序保留；归一化后走既有注册管线 |
| UT-S53-02 | 冲突 fail-loud 矩阵 | schema / 归一化 / 运行时合并 | `providers` 与 `providerList` 同供；数组内重复路由键；缺失或空 `provider` 字段；非法档案条目；数组+settings 并存 | 分别加载或触发 volatile-update | 自包含冲突加载期硬失败且消息指名路由与来源；数组+settings 合并冲突以诊断错误失败且路由集保持上一有效集；均无静默降级 |
| UT-S53-03 | dict 与 settings 回归 | 既有管线 | dict 形式与 settings 供给的既有用例集 | 回归运行 | 解析、活重配、HMR dispose 语义不变；dict 值中 `provider` 字段仍被拒绝（迁移守卫不变） |
| UT-S53-04 | 真实 Loader 数组组合 | loader-composition | 数组形式组合经真实 Loader 启动 | 启动并检查 `listProviders` 与配置更新/HMR | 多路由注册活；配置更新与 HMR 语义与 dict 组合一致；dispose 后路由移除 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S53-01 | 跨供应商切换全链路（网络通道 + mock 路由） | S53-AC-01/02/03 | 数组组合的 acp-network 实例（两个 mock HTTP 供应商路由） | `session/new` → configOptions 分组核对 → `set_config_option` 切换 → prompt 往返 → 断开重连 `session/resume` → 冲突组合独立启动验证 | 切换生效并命中被切换路由；resume 后选择保持；冲突组合加载期指名失败 |

### 回归与真实验收

- 复用既有 config / dynamic-config / loader-composition 用例：dict 形式、settings 活重配与 HMR 语义不变。
- 复用 UT-S49-01、UT-S49-05：configOptions 面与 resume 广告结构不变。
- 复用 UT-S50-01、UT-S50-05、UT-S51-01..06、UT-S52-01..06 与 S15 既有压缩用例：审批策略、技能枚举、计划模式、压缩面与自有 UI 压缩通道不受配置面变化影响。
- 复用 ST-S03-01、ST-S03-02：ACP 主链路不受配置面变化影响。
- SMOKE-acp-network-01..06 既有回归；SMOKE-acp-network-07 是 S53-AC-01/02 真实部署面的计划用例；staging 默认组合无数组供给时按 skip 语义如实记录，不得伪报 PASS。

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S53-AC-01 | 数组组合与 dict 组合等价 | UT-S53-01、UT-S53-04、ST-S53-01 |
| S53-AC-02 | 跨供应商切换与持久 | ST-S53-01、SMOKE-acp-network-07 |
| S53-AC-03 | 形态冲突 fail-loud | UT-S53-02、UT-S53-04、ST-S53-01 |
| S53-AC-04 | 既有供给语义回归 | UT-S53-03 及复用 ID、SMOKE-acp-network-01..06 |

## 覆盖度校验

- [ ] 归一化等价、冲突矩阵、dict/settings 回归、真实 Loader 组合均有自动化用例。
- [ ] 产品可见组合包含真实 Loader 数组组合证据（含 HMR dispose 观察）。
- [ ] 部署面由 SMOKE-acp-network-07 承载；staging 不可复现时如实记录，不伪报。

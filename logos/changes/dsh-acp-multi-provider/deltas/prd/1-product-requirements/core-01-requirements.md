# delta — core-01-requirements.md（变更 dsh-acp-multi-provider）

## MODIFIED — 三、场景总览（表格追加一行）

在场景总览表 S52 行后追加：

```markdown
| S53 | 部署配置以数组形态供给多供应商路由 | 部署方以数组形式声明多个供应商路由，客户端在同实例上跨供应商选择 | P01/P08 | P1 |
```

## ADDED — 四、核心场景详述：S53

在 §四 S52 小节之后、"## 五、约束与边界" 之前插入：

```markdown
### S53: 部署配置以数组形态供给多供应商路由

- **触发条件**：部署方（dspm）在组合配置（profile patch）以数组形式为 `llm-pi-ai` 声明多个供应商路由（每项携带路由键与各自 baseURL / apiKey 凭据引用）；外部 ACP 客户端经 `session/new` 响应的 configOptions 观察按供应商分组的模型选项，经 `set_config_option` 在同实例上跨供应商切换并跨 resume 持久。
- **用户价值**：单实例服务多供应商，一份部署工件表达全部路由，不再需要「每实例单 provider + 切换重排」的供给链；会话级选择与既有协议面一致（← P01/P08）。
- **优先级**：P1
- **主路径**：数组在配置解析入口归一化进既有 dict 管线 → 路由注册（适配器、可配置目录、模型发现）与凭据解析全部复用既有实现 → acp-network 会话创建按 provider/model 值对选择默认路由，configOptions 按供应商分组广告全部路由 → `set_config_option` 切换路由与模型，经 EpochHeader 持久、resume 恢复。dict 形式与 settings 文档供给语义不变。
- **边界**：settings 文档仍仅接受 dict（逐键合并、活重配；web Models 页机制不变），数组为组合层的静态声明形式；数组与 dict 双形式同供、数组内重复路由键、数组项缺失或空路由键、数组项档案非法均加载期 fail-loud（指名路由与来源），数组形式与 settings 供给并存按既有冲突语义诊断并保持上一有效路由集；acp-network 的 provider/model 值对保持默认路由选择语义，指向未注册路由在会话创建时 fail-loud（既有行为）；零新增会话事件与 wire 类型，Session format 不变。
```

## ADDED — 四、S53 验收条件

接在 S53 边界段之后：

```markdown
#### 验收条件
##### 正常：数组组合与 dict 组合等价
- **GIVEN** 同一路由集分别以数组与 dict 形式在组合配置声明
- **WHEN** Loader 加载并注册
- **THEN** 解析结果、可配置目录条目、注册路由集与凭据解析行为逐项等价；configOptions 按供应商分组广告全部路由
##### 正常：跨供应商切换与持久
- **GIVEN** 数组组合的实例上存在两个供应商路由
- **WHEN** `session/new` 后 `set_config_option` 切换到另一路由的模型，prompt 往返，断开重连 `session/resume`
- **THEN** 切换生效（请求命中被切换路由），resume 后选择保持
##### 异常：形态冲突 fail-loud
- **GIVEN** 双形式同供、数组内重复路由键、缺失或空路由键、非法档案条目、数组+settings 并存各一
- **WHEN** 加载配置或触发运行时合并
- **THEN** 自包含冲突加载期失败并指名路由与冲突来源；数组+settings 合并冲突以诊断错误失败且路由集保持上一有效集；均不静默降级
##### 回归：既有供给语义不变
- **GIVEN** dict 形式组合、settings 文档活重配、单路由部署与既有 ACP 面
- **WHEN** 执行 S03、S15、S49、S50、S51、S52 回归与 SMOKE-acp-network-01..06
- **THEN** 既有行为保持；configOptions 面与 resume 广告结构不变
```

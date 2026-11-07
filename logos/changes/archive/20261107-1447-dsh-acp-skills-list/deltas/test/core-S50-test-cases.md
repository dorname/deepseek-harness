# core S50（外部客户端枚举会话技能清单）— 测试用例

> 来源：变更 `dsh-acp-skills-list`。场景来源 `core-01-requirements.md` §S50；场景实现见 `core-S50-acp-skills-list.md`。
> 解析链与双旗标必须在真实 ACP bridge 组合上验证；keyless 快照固定方法面与清单映射行为。

## S50: 外部客户端枚举会话技能清单

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S50-01 | 方法注册与参数校验 | bridge `session/skills_list` | 测试会话（桥接拥有）+ 未知 id | 对有效与未知会话 id 分别调用 | 有效会话返回 `{ skills }`；未知会话返回 invalid params 类错误；响应结构仅含约定字段 |
| UT-S50-02 | 解析链：预设作用域与全局回退 | 注册表解析 | 会话 A 由挂载技能插件的预设派生（含同名覆盖技能）；会话 B 无预设挂载 | 分别枚举并对照 `skill` 工具可见目录 | 会话 A 取预设作用域最近层同名覆盖胜者；会话 B 回退全局注册表；两者与会话内技能目录一致 |
| UT-S50-03 | 双旗标与无过滤映射 | 清单字段映射 | 目录含 modelInvocable=false 与 userInvocable=false 技能 | 枚举并逐项核对 frontmatter 解析值 | 两类专属技能均列出；`modelInvocable`/`userInvocable` 与注册表解析值一致；名字典序；`description` 全文；无 `path`/`whenToUse`/`source`/`provider` 字段 |
| UT-S50-04 | 注册表缺失 fail-loud | 错误分支 | 组装无 `dsh-skill` 的测试组合 | 调用 `session/skills_list` | internal error 类错误且说明缺装配；不返回空列表、不静默降级 |
| UT-S50-05 | 真实 Loader 组合与快照 | LLM + skill-filesystem + ACP 真实组合、keyless 快照 | 真实 Loader 启动测试 cordis.yml（真实技能目录） | 创建会话、枚举、重复枚举、对照会话日志 | 产品组合下清单与目录一致；重复调用结果一致且无新增会话事件；快照固定方法面与字段映射行为 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S50-01 | ACP 技能枚举全链路（真实 bridge） | S50-AC-01/03 | 真实 ACP bridge（stdio 或 network）；含已知技能的目录 | new → skills_list → 未知会话 id 调用 → prompt 正常往返 → close → resume → skills_list | 清单与目录一致、双旗标正确；未知会话错误；prompt/resume 不受影响；resume 后枚举一致 |

### 回归与真实验收

- 复用 ST-S03-01、ST-S03-02：ACP initialize→prompt 主链路与取消不受新方法影响。
- 复用 UT-S49-01、UT-S49-05：configOptions 面与 resume 广告结构不变。
- 复用 acp-network UT-S01、UT-S03、ST-S01、ST-S02：网络连接、断连 resume 既有回归。
- SMOKE-acp-network-04 是 S50-AC-05 真实部署面的计划用例；枚举不可复现时如实记录，不得伪报 PASS。

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S50-AC-01 | 清单枚举与双旗标 | UT-S50-01、UT-S50-03、ST-S50-01 |
| S50-AC-02 | 预设作用域解析与同名覆盖 | UT-S50-02 |
| S50-AC-03 | 未知会话与注册表缺失 fail-loud | UT-S50-01、UT-S50-04、ST-S50-01 |
| S50-AC-04 | 只读无副作用 | UT-S50-05 |
| S50-AC-05 | 真实组合、快照与部署面枚举 | UT-S50-05、ST-S50-01、SMOKE-acp-network-04 |
| S50-AC-06 | 既有通道与会话回归 | ST-S50-01 及上述复用 ID |

## 覆盖度校验

- [x] 解析链、双旗标、错误 fail-loud、只读性均有自动化用例。
- [x] 产品可见组合包含真实 Loader 组合证据；方法面与字段映射包含 keyless 快照。
- [x] 部署面真实枚举由 SMOKE-acp-network-04 单独承载，不可复现时如实记录，不伪报。

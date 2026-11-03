# delta — core-S48-test-cases.md（变更 dsh-provider-model-discovery）

## ADDED — core S48（DeepSeek 动态模型目录）— 测试用例

# core S48（DeepSeek 动态模型目录）— 测试用例

> 来源：变更 `dsh-provider-model-discovery`。场景来源 `core-01-requirements.md` §S48；场景实现见 `core-S48-provider-model-discovery.md`。
> Mock/可控端点只覆盖 AC-1～AC-5 与 AC-7；真实供应商 AC-6 仅由 SMOKE-core-25 或等效 real-API 记录证明。

## S48: 按供应商 baseURL 动态发现 DeepSeek 模型目录

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S48-01 | 动态替代、人工覆盖与精确解析 | `llm-deepseek-api-key` discovery/config | 可控端点返回带名称变体、重复 ID、畸形条目和空 data 的响应 | 分别省略 models、显式 models、显式空 models 后读取目录 | 动态结果完整替代内置目录；人工覆盖跳过网络且空覆盖为空；名称优先级、首次去重、上游顺序和原样 ID 正确；不编造能力元数据，成功空 data 不补静态项 |
| UT-S48-02 | URL、认证与密钥脱敏 | discovery 请求构造与错误 | 准备 `/anthropic`、末尾斜杠、已有 `/v1`、额外网关前缀和凭据轮换 | 发起发现并检查请求、错误、日志与缓存元数据 | URL 保留前缀且 `/v1/models`/`/models` 正确；x-api-key 与 anthropic-version 来自当前路由；原始密钥不出现在 URL、错误、日志或缓存键 |
| UT-S48-03 | 成功缓存、失效与 singleflight | discovery cache | 可控响应序列与延迟屏障，覆盖 TTL/0 TTL、配置和凭据代际变化 | 并发读取、有效期内读取、到期读取、失败重试并修改返回数组 | 同键并发恰一上游请求；只复用成功结果（含空数组）；0 TTL 仍合并并发；配置/凭据变化隔离；失败不缓存；返回副本互不影响 |
| UT-S48-04 | 超时、独立取消、响应限界与释放 | discovery transport/lifecycle | 可控慢响应、分块正文、多 waiter 与插件 dispose | 分别超时、取消一个/全部 waiter、声明或实际超过 4 MiB、卸载插件 | 头和正文读取有界；单 waiter 取消不影响他人，最后取消中止共享传输；过大明确报错；dispose 中止并等待静默，迟到结果不复活缓存 |
| UT-S48-05 | 发现错误分类与重试 | discovery error mapping | 模拟缺凭据、连接失败、401/403、404、429、500、非法 JSON、缺 data、非数组 data、过大与超时 | 逐类读取目录，随后恢复有效响应 | 每类错误可区分且不含响应正文或密钥；不返回静态/历史目录；失败后可重试成功；成功空 data 与失败严格区分 |
| UT-S48-06 | ACP 错误、空 options、移除模型与原子性 | ACP model-control/bridge | mock 动态目录成功、失败、为空及移除当前模型；覆盖 new/resume/set | 构建 options、设置失效值、让后继 options 构建失败 | 不吞 provider 错误；空目录 options 为空；旧 currentValue 可保留但不进 choices/options；失效值拒绝；选择仅在新状态完整成功后提交；new/resume 回滚 |
| UT-S48-07 | 真实 Loader 组合与精确模型 ID | LLM runtime、DeepSeek adapter、ACP、keyless 快照 | 真实 Loader 启动测试 cordis.yml，可控 HTTP 同时提供 models 与 inference | 动态发现、ACP 选择模型并 prompt；传递取消信号 | 产品组合只发布动态 choices；最终请求模型字段等于精确上游 ID；取消信号贯通；快照固定移除模型不回补的用户可见行为，不新增 Session/SDK 表面 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S48-01 | ACP 目录 A/B → B/C 刷新与精确推理 | S48-AC-01/02/05 | 可控端点先返回 A/B 后返回 B/C；当前模型为 A；TTL 可控 | new → 选择 A → 等待失效或改变代际 → 刷新 options → 尝试选 A → 选择 C → prompt | 首次目录仅 A/B；刷新后仅 B/C；A 可保留 currentValue 但不在 options 且设置拒绝；C 设置成功；持久化与最终请求均使用 C 的原样 ID |
| ST-S48-02 | 失败、空目录、重试与既有推理隔离 | S48-AC-04/07 | 可控端点依次故障、成功空 data、恢复有效目录；已有会话使用已提交模型 | 读取目录/创建会话 → 触发空目录与重试 → 在目录故障期间执行已有纯推理 | 故障显式传播且无静态 choices，空目录成功但为空，恢复后重试成功；目录故障不强制中断已有纯推理；客户端显式读取仍得到真实错误 |

### 回归与真实验收

- 复用 ST-S03-01、ST-S03-02：ACP initialize/prompt 与 prompt 取消；发现请求取消由 UT-S48-04 单独覆盖。
- 复用 ST-S20-01、ST-S20-02、ST-S20-03：凭据引用、自定义兼容网关和会话默认模型。
- 复用 ST-S26-01：重启后的会话恢复与历史模型状态。
- 复用 SMOKE-core-06、SMOKE-acp-network-01、SMOKE-acp-network-02：通用真实推理及 ACP 网络会话回归。
- SMOKE-core-25 是唯一可证明 S48-AC-06 的计划用例；无真实 Secret、目录不含目标模型或第二模型权限失败时必须记录实际未覆盖/失败原因，不能记为成功。

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S48-AC-01 | 动态目录替代默认目录 | UT-S48-01、UT-S48-07、ST-S48-01 |
| S48-AC-02 | 上游变化、缓存失效与并发刷新 | UT-S48-03、ST-S48-01 |
| S48-AC-03 | URL、认证与脱敏 | UT-S48-02 |
| S48-AC-04 | 失败、空态、限界、取消与重试 | UT-S48-04、UT-S48-05、UT-S48-06、ST-S48-02 |
| S48-AC-05 | 动态模型切换与精确请求 ID | UT-S48-06、UT-S48-07、ST-S48-01 |
| S48-AC-06 | 真实供应商目录与推理 | SMOKE-core-25 |
| S48-AC-07 | 既有推理、恢复与取消回归 | ST-S48-02 及上述复用 ID |

## 覆盖度校验

- [x] 动态、人工覆盖、空目录、刷新、错误、取消、安全和精确 ID 均有自动化用例。
- [x] 产品可见插件包含真实 Loader 组合证据，ACP 用户可见行为包含 keyless 快照。
- [x] 真实 AC-6 与 Mock 证据明确分离，失败或未执行不得伪报。

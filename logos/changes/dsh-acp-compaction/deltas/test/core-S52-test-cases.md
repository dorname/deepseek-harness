# core S52（外部客户端触发会话压缩并感知压缩生命周期）— 测试用例

> 来源：变更 `dsh-acp-compaction`。场景来源 `core-01-requirements.md` §S52；场景实现见 `core-S52-acp-compaction.md`。
> 同步方法与错误映射在真实 ACP bridge 组合上验证（压缩执行需真实模型产历史，由真实 API 通道承载）；keyless 快照固定方法面、响应结构与错误分支 wire 面。

## S52: 外部客户端触发会话压缩并感知压缩生命周期

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S52-01 | 方法注册与参数校验 | bridge `session/compact` | 测试会话（桥接拥有）+ 未知 id | 对有效、未知会话与空参分别调用 | 有效会话进入执行路径（或返回 busy/null 语义）；未知会话与空参返回 invalid params 类错误；响应/错误结构仅含约定字段 |
| UT-S52-02 | 成功响应映射与 sourceCommandId | `compactNow` 结果映射 | 真实组合会话（真实 API）有可压缩历史 | 调用并检查响应与会话日志 | 响应含 compactionId / summarySeq / shadowedCount / shadowedTokenCount / summary；日志三元组 `sourceCommandId` 为 `acp-` 前缀 bridge 自铸 id；`/compact` 命令通道结果一致 |
| UT-S52-03 | 六失败码映射 | 错误映射 | 注入 ManualCompactionError 各码与请求中止 | 分别触发并检查 JSON-RPC 错误 | 每码 internal error 且 `data.code` 正确、message 与 `/compact` 人类文本一致；中止 → `cancelled`；非预期异常走通用 internal error |
| UT-S52-04 | 无可压缩历史与 busy | 边界分支 | 新会话（无历史）；压缩进行中并发调用 | 分别调用 | 无历史合法 `{ result: null }` 且零压缩事件；竞态调用 `data.code: 'busy'` |
| UT-S52-05 | 能力门控通知派发 | `compaction_update` 派生 | 声明与未声明 `session.compaction` 的两类连接 | 真实组合执行一次压缩，观察两连接 | 声明者按序收到 in_progress 与 completed（含前置 `compaction/summary` 事件内容块）或 failed（含错误文本）；未声明者零通知；失败注入时 failed 文本取 end 事件 error |
| UT-S52-06 | 服务缺席 fail-loud 与快照 | 无压缩组合、keyless 快照 | 组装无 compaction 插件的测试组合；真实 Loader 组合 | set 调用与 new 响应检查；快照录制比对 | internal error 且说明缺装配；真实组合下方法面、响应结构与错误分支 wire 面与快照一致；既有 configOptions/prompt 行为不变 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S52-01 | ACP 压缩全链路（真实 bridge + 真实 API） | S52-AC-01/03/04 | 真实 ACP bridge；DEEPSEEK_API_KEY（e2e 通道，无 key 自跳过） | new → prompt 产历史 → compact → resume → 验证 shadow 生效 → 声明能力连接核对通知序列 → busy 竞态 → 未知会话 | 全链路符合规格；resume 后压缩生效；通知门控正确；既有通道不受影响 |

### 回归与真实验收

- 复用 ST-S03-01、ST-S03-02：ACP 主链路与取消不受新方法影响。
- 复用 S15 既有压缩用例：`/compact` 命令、自动触发与自有 UI 通道不变。
- 复用 UT-S49-01、UT-S49-05、UT-S50-01、UT-S50-05、UT-S51-01..06：审批策略、技能枚举、计划模式面不变。
- SMOKE-acp-network-06 是 S52-AC-05 真实部署面的计划用例；压缩执行不可复现时如实记录，不得伪报 PASS。

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S52-AC-01 | 显式压缩同步往返 | UT-S52-02、ST-S52-01 |
| S52-AC-02 | 无可压缩历史 | UT-S52-04 |
| S52-AC-03 | 能力声明客户端的压缩通知 | UT-S52-05、ST-S52-01 |
| S52-AC-04 | busy 与错误分支 | UT-S52-01、UT-S52-03、UT-S52-04、ST-S52-01 |
| S52-AC-05 | 既有通道与会话回归 + 真实部署面 | UT-S52-06、ST-S52-01、SMOKE-acp-network-06 及上述复用 ID |

## 覆盖度校验

- [ ] 参数校验、六码映射、null 边界、busy 竞态、通知门控、fail-loud 均有自动化用例。
- [ ] 产品可见组合包含真实 Loader 组合证据；方法面与错误分支 wire 面包含 keyless 快照。
- [ ] 部署面真实压缩由 SMOKE-acp-network-06 单独承载（真实模型产历史），不可复现时如实记录，不伪报。

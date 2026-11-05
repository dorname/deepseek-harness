# core S49（外部客户端配置会话审批策略与预设）— 测试用例

> 来源：变更 `dsh-acp-permission-policy`。场景来源 `core-01-requirements.md` §S49；场景实现见 `core-S49-acp-permission-policy.md`。
> 审批往返与 resume 恢复必须在真实 ACP bridge 组合上验证；keyless 快照固定 configOptions 广告与策略切换的模型可见行为。

## S49: 外部客户端配置会话审批策略与预设

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S49-01 | 词表校验与 fail-loud | bridge `setSessionConfigOption` | 测试会话；审批/预设插件已组装 | 依次设置 `permission_policy` ∈ ask/never/always、未知值、未知预设名 | 合法值接受；未知值与未知预设返回 invalid params 类错误且策略/预设状态不变；错误不吞、不回退默认 |
| UT-S49-02 | always 档全量询问与一次性应答 | pre-execute 询问源 + serviceAsk | 会话策略 `always`；可控 answerer | 执行文件写与终端等多次工具调用，分别应答 allow-once / reject-once | 每次调用执行前恰一次询问；allow-once 后执行；reject-once 后该调用被拒且回合继续；无 `allow_always` 选项；一次性语义成立 |
| UT-S49-03 | never 档自动拒绝 | ApprovalService never 分发 | 会话策略 `never`；注入 hook ask 与 sandbox 升权触发源 | 触发两类询问 | 询问被自动拒绝，不经 answerer、不发起 `session/request_permission`，会话与回合不中断 |
| UT-S49-04 | 事件落库与模型可见通知 | `ApprovalService.setPolicy` 持久化 | 测试会话 | 依次设置 ask→always→never 并检查日志与投影 | `approval/policy` 事件逐次落库、LAST-wins 折叠生效；模型可见切换通知落日志；无新增 Session 事件类型 |
| UT-S49-05 | resume 恢复与 configOptions 广告 | new/resume configOptions 构建 | 会话已设置策略与预设并 close | 新会话读取、resume 后读取 configOptions；resume 后触发一次询问 | new/resume 广告 `permission_policy` 当前值与 `permission_preset` 预设目录；resume 后策略生效（如 never 吞询问） |
| UT-S49-06 | 预设应用与目录枚举 | permission-presets ACP 入口 | 预设插件已组装 | 设置 `permission_preset=read-only`，读取目录，依次应用各档 | 预设目录动态枚举 read-only/workspace-write/danger-full-access；应用按现行 `{sandbox, approval}` 定义生效并落日志；read-only 越界写行为与 ST-S22-02 一致 |
| UT-S49-07 | 真实 Loader 组合与快照 | LLM + tools + approval + ACP 真实组合、keyless 快照 | 真实 Loader 启动测试 cordis.yml | always 会话工具调用审批往返；configOptions 与策略切换通知快照 | 产品组合下审批往返与 UT-S49-02 一致；快照固定新 option id 广告与切换通知的模型可见行为；无新增 Session/SDK 表面 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S49-01 | ACP always 审批往返（allow/reject 分支） | S49-AC-02/06 | 真实 ACP bridge（stdio 或 network）；可控模型产生工具调用 | new → 设置 always → prompt（工具调用）→ allow-once → 第二次调用 reject-once → 结算 | 每次调用前收到 `session/request_permission`（含工具信息与两个一次性选项）；allow 后执行、reject 后拒绝；会话继续至 `end_turn` |
| ST-S49-02 | never 档、resume 恢复与默认行为 | S49-AC-03/04 | 真实 ACP bridge；持久化存储；sandbox 升权触发源 | 设置 never → 触发升权（自动拒绝）→ close → resume → 验证策略与 configOptions → 另开会话不设置策略执行升权 | never 下升权不发起询问且调用被拒；resume 后策略恢复生效、configOptions 回显；未设置策略的会话升权询问正常送达（默认行为不变） |

### 回归与真实验收

- 复用 UT-S21-01、UT-S21-02：无 answerer fail-closed 与 asked/decided 事件成对落日志。
- 复用 ST-S21-01、ST-S21-02、ST-S22-01、ST-S22-02：既有审批允许/拒绝与沙箱升权回归。
- 复用 ST-S03-01、ST-S03-02：ACP initialize→prompt 主链路与取消。
- 复用 acp-network UT-S01、UT-S03、ST-S01、ST-S02：网络连接、断连 resume 与权限回环既有回归。
- SMOKE-acp-network-03 是 S49-AC-06 真实部署面的计划用例；审批往返不可复现时如实记录，不得伪报 PASS。

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S49-AC-01 | 词表校验与 fail-loud | UT-S49-01 |
| S49-AC-02 | always 全量询问与一次性应答 | UT-S49-02、ST-S49-01 |
| S49-AC-03 | never 自动拒绝与 ask 默认放行 | UT-S49-03、ST-S49-02 |
| S49-AC-04 | 事件落库、切换通知与 resume 恢复 | UT-S49-04、UT-S49-05、ST-S49-02 |
| S49-AC-05 | 预设应用与目录枚举 | UT-S49-06 |
| S49-AC-06 | 真实组合、快照与部署面往返 | UT-S49-07、ST-S49-01、SMOKE-acp-network-03 |
| S49-AC-07 | 既有审批、升权与会话回归 | ST-S49-02 及上述复用 ID |

## 覆盖度校验

- [x] 词表、三档分发、事件持久化、resume 恢复、预设、错误与 fail-closed 均有自动化用例。
- [x] 产品可见组合包含真实 Loader 组合证据；configOptions 广告与切换通知包含 keyless 快照。
- [x] 部署面真实审批往返由 SMOKE-acp-network-03 单独承载，不可复现时如实记录，不伪报。

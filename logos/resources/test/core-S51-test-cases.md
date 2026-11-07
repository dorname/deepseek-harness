# core S51（外部客户端经 ACP 感知与切换计划模式）— 测试用例

> 来源：变更 `dsh-acp-plan-mode`。场景来源 `core-01-requirements.md` §S51；场景实现见 `core-S51-acp-plan-mode.md`。
> 模式面与评审转换必须在真实 ACP bridge 组合上验证；keyless 快照固定 modes 广告与错误分支的 wire 面。plan-review 映射的模型触发路径由真实 API e2e 承载，确定性冒烟不含模型行为依赖。

## S51: 外部客户端经 ACP 感知与切换计划模式

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S51-01 | 方法注册与参数校验 | bridge `session/set_mode` | 测试会话（桥接拥有）+ 未知 id + 未知 modeId | 对未知会话、`modeId: 'other'`、空参分别调用 | 未知会话与未知 modeId 返回 invalid params 类错误且词表（plan/normal）出现在消息中；空参走扩展解析；会话关闭中 invalid params |
| UT-S51-02 | modes 广告与 resume 恢复 | new/resume 响应 | 无开放回合的会话；切换并提交后 resume | 检查 new 响应 `modes`、set plan、resume 后再查 | new 为 normal；availableModes 恰为 plan/normal 二值含 name/description；resume 后 currentModeId 为 plan；插件缺席的组合省略 `modes` 字段 |
| UT-S51-03 | 提交推送与四态时序 | `plan/mode` → `current_mode_update` 派发 | 空闲会话与开放回合会话各一 | 空闲切换（committed）、回合中切换（queued）、重复设置（noop）、清除反向排队（cancelled） | committed 紧随一次更新；queued 响应先行、更新随 accepted pre-step 到达；noop/cancelled 零更新；更新由持久事件派生（日志含 `plan/mode`） |
| UT-S51-04 | 评审转换三态 | plan-review → request_permission 映射 | 计划模式会话；模拟 plan-review intent 问题 | 分别应答 approve 选项、keep-planning 选项、outcome cancelled | approve 映射 `selected: ['Approve']` 且 controller 退出排队生效；keep-planning 映射 `selected: ['Keep planning']`；cancelled 映射 `ASK_CANCELLED`；请求先 drainUpdates、options 恰为 approve(allow_once)/keep-planning(reject_once)、toolCall 携带 intent callId |
| UT-S51-05 | 评审收窄与放行 | 瀑布应答者拦截条件 | 非自有会话、多问题请求、非 plan-review intent（含无 intent 的普通问题） | 分别发起并观察瀑布 | 三类均 `next()` 放行，最终 `NO_PROVIDER` 语义不变；自有会话 plan-review 之外的组合同样放行 |
| UT-S51-06 | 插件缺席 fail-loud 与快照 | 无 plan-mode 组合、keyless 快照 | 组装无 `dsh-plan-mode` 的测试组合；真实 Loader 组合 | set_mode 调用与 new 响应检查；快照录制比对 | internal error 类且说明缺装配；new/resume 无 `modes` 字段；真实组合下 modes 广告、set_mode 往返、错误分支 wire 面与快照一致 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S51-01 | ACP 模式面全链路（真实 bridge） | S51-AC-01/02/03/05 | 真实 ACP bridge（stdio 或 network）；真实 API（e2e 通道，无 key 自跳过） | new → 读 modes → set plan → 驱动一次含 `exit_plan_mode` 评审的真实回合 → set normal → 未知 modeId → close → resume → 读 modes | 全链路时序与三态评审符合规格；resume 恢复已提交模式；既有 prompt/resume 行为不变 |

### 回归与真实验收

- 复用 ST-S03-01、ST-S03-02：ACP 主链路与取消不受新方法与 `modes` 字段影响。
- 复用 S11 既有计划模式用例：`/plan` 命令、投影折叠与自有 UI 通道不变。
- 复用 UT-S49-01、UT-S49-05：configOptions 面与 resume 广告结构不变（`modes` 为新增可选字段）。
- 复用 UT-S50-01、UT-S50-05：skills_list 方法面与零事件副作用不变（`current_mode_update` 仅由模式提交触发）。
- SMOKE-acp-network-05 是 S51-AC-06 真实部署面的计划用例；模式面不可复现时如实记录，不得伪报 PASS。

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S51-AC-01 | modes 广告与 resume 恢复 | UT-S51-02、UT-S51-06、ST-S51-01 |
| S51-AC-02 | set_mode 提交与 current_mode_update | UT-S51-03、ST-S51-01 |
| S51-AC-03 | 回合中切换为排队生效 | UT-S51-03 |
| S51-AC-04 | 计划评审经 request_permission 闭环 | UT-S51-04、UT-S51-05、ST-S51-01 |
| S51-AC-05 | 未知会话、未知模式与插件缺席 fail-loud | UT-S51-01、UT-S51-06、ST-S51-01 |
| S51-AC-06 | 既有通道与会话回归 + 真实部署面 | ST-S51-01、SMOKE-acp-network-05 及上述复用 ID |

## 覆盖度校验

- [ ] 词表校验、四态时序、评审三态、评审收窄、fail-loud 均有自动化用例。
- [ ] 产品可见组合包含真实 Loader 组合证据；modes 广告与错误分支 wire 面包含 keyless 快照。
- [ ] 部署面真实模式面由 SMOKE-acp-network-05 单独承载；plan-review 模型触发路径由真实 API e2e（ST-S51-01）承载，不可复现时如实记录，不伪报。

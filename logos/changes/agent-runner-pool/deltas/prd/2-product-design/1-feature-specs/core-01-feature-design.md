# delta — core-01-feature-design.md（变更 agent-runner-pool）

## ADDED — 6. 执行池交互规格（S37–S39）

执行池是部署形态能力：在共享持久层（S34–S36）之上把「执行」从每用户本地 Host 进程升级为可多副本、可接管的 runner 池。用户可感知面不变（同一 Web UI、同一会话列表，`ui_impact: false`）；可感知变化是「任一副本都能实时看到任一会话」与「runner 崩溃后会话自动续跑」。运维可感知面是 runner/副本角色的启动配置（库级 Runner 编排，cordis.yml 指定租约/队列/中继后端与连接串；配置缺失/不可达 loud fail）。

三条新能力全部落新 Service Definition（`sessionLease`、`streamRelay`）与新编排包（`agent-dispatch`），`agent-loop` 与既有缝签名零改动；租约在「启动 Agent 前获取、丢失即 cancel」的外层实现。

### S37: 会话租约 — 交互规格（运维/开发面）

**入口**：执行池部署以 `session-lease-postgres` 插件启动，runner 进程共享同一租约表

**行为规范**：
1. **原子获取**：`acquire(sessionId, owner, ttl)` 为单条原子语句——无租约或已过期时成功，未过期被持有时返回明确占用失败（含持有者与到期时刻）
2. **心跳续约**：持有者周期 `renew`；续约失败（已被接管/释放）明确返回丢失
3. **过期接管恰一胜者**：接管与获取同一条原子语句，并发接管恰一成功，败者得占用失败
4. **属主信息面**：`ownerOf(sessionId)` 暴露当前持有者节点标识，供终端/jobs 路由决策（本里程碑不搬移 PTY 进程）
5. **丢失通知**：`waitLost(sessionId, owner)` 在持有者视角的丢失（接管/过期回写）时 settle，外层据此 `agent.cancel()`——`agent-loop` 自身零感知

#### 验收条件（交互级）

##### 正常：获取-续约-释放
- **GIVEN** 会话无租约
- **WHEN** A 获取并持续续约
- **THEN** 期间 `ownerOf` 恒为 A；释放后立即可被获取
##### 异常：并发竞争恰一胜者
- **GIVEN** 会话租约空闲
- **WHEN** A、B 并发获取
- **THEN** 恰一成功；败者得占用失败并可见胜者
##### 异常：崩溃后接管
- **GIVEN** A 停止续约超过 ttl
- **WHEN** B 获取
- **THEN** B 原子接管成功；A 的 `waitLost` 同时 settle

### S38: 队列派发与 inbox 接续 — 交互规格（运维/开发面）

**入口**：入口面（网关/webhook/用户消息）调用 `agentDispatch.publish(sessionId)`；runner 进程运行 Runner 编排循环

**行为规范**：
1. **队列去重**：同一会话已在队列时不重复入队；派发项被取走后再次投递可重新入队
2. **唤醒与兜底**：入队即 NOTIFY 唤醒等待 runner；轮询兜底保证 NOTIFY 丢失时不滞留
3. **先取租约再执行**：runner 取到派发项后先 `acquire` 会话租约；占用失败则重试窗口内等待，绝不并发执行
4. **接续走既有恢复语义**：执行入口是 `agents.resume`——从共享持久层加载会话，durable inbox 投影决定未消费输入的接续；接管点只允许 turn 边界
5. **丢失即取消**：Runner 编排以 `waitLost` 驱动 `agent.cancel()`；取消后释放租约并按需重新入队

#### 验收条件（交互级）

##### 正常：派发接续
- **GIVEN** 会话有历史与未消费 inbox 输入且无租约
- **WHEN** 入队且空闲 runner 取走
- **THEN** 该 runner 获取租约、恢复会话、消费输入继续执行
##### 异常：runner 崩溃后其他节点接续
- **GIVEN** runner A 执行中被 kill
- **WHEN** 租约过期且队列仍有该会话
- **THEN** 其他 runner 接管并继续未消费输入，事件序列无重复副作用
##### 异常：双 runner 竞争被排除
- **GIVEN** 两 runner 同时取到同一会话的派发
- **WHEN** 各自尝试获取租约
- **THEN** 恰一执行，另一等待

### S39: 流中继 — 交互规格（运维/开发面）

**入口**：runner 挂 `stream-relay-postgres` 发布端；Web/API 副本挂订阅端（session-controller follow 数据面）

**行为规范**：
1. **单调序号**：每会话的记录（`session/event` 与 assistant-stream 帧）按序号单调递增发布到中继日志表
2. **NOTIFY 仅作唤醒**：通知载荷只含会话标识；记录本体从共享表按序读取（不受通知载荷上限约束）
3. **游标追赶**：订阅以「已读最大序号」为游标，从游标之后完整回放，无缺口无重复；中途订阅者与断线重连同路
4. **事件语义不变**：中继只搬运既有事件/帧的序列化形态，不新增、不改写、不重排；副本侧以 Session-follow 既有语义呈现
5. **读取面解耦属主**：非属主副本为浏览器提供的冷读（共享持久层）+ live 增量（中继）合并视图

#### 验收条件（交互级）

##### 正常：双副本同看流
- **GIVEN** runner 执行会话，两副本各自订阅
- **WHEN** 帧与事件持续发布
- **THEN** 两副本按相同序号收到相同记录
##### 异常：中途订阅追赶
- **GIVEN** 副本从序号 N 之后才开始订阅
- **WHEN** 以 N 为游标订阅
- **THEN** 收到 N+1 起的全部记录，无缺口无重复

# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — core-01-requirements.md：「三、场景总览」表追加 S37–S39 行（整表守恒携带既有 36 行）；「四、核心场景详述（P0）」新增 S37/S38/S39 详述；「5.3 不做清单」修订（MODIFIED 携带剩余全量：新增不做项——Redis pub/sub 中继 Provider、PTY 进程远程化、Web/API 副本无状态化编排）
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — core-01-feature-design.md：ADDED S37–S39 交互规格章节（租约面板语义、派发接续、双副本流式视图）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/` — core-system-map.md：ADDED「执行池」章节（租约/队列/中继组件、`session_leases`/`agent_dispatch_queue`/`stream_relay_log` DDL、接管与派发时序不变式）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S37-session-leases.md（S37 场景时序图：获取/续约/竞争/过期接管）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S38-dispatch-continuation.md（S38 场景时序图：队列派发与 inbox 投影接续）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S39-stream-relay.md（S39 场景时序图：runner 发布、副本订阅追赶）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — core-01-deployment-plan.md：MODIFIED「二、部署拓扑」「三、环境变量与密钥」「七、部署后检查清单」「八、冒烟测试方案」（各自携带既有全量条目）+ ADDED 执行池条目（runner/副本角色、staging 双 runner 进程）
- [x] 产出 delta 文件到 `deltas/test/` — 新文档 core-S37-S39-test-cases.md（UT-S37..39 / ST-S37..39 用例 + AC 追溯表 + 验收执行资源约束）
- [x] 产出 delta 文件到 `deltas/test/smoke/` — core-smoke-test-cases.md：MODIFIED「二、冒烟测试用例」表追加 SMOKE-core-14/15（整表守恒携带既有 13 行）与「三、覆盖度校验」更新
- [x] 同步 `logos/logos-project.yaml` 的 `scenario_counter.next_id` 至 40（M1/M2 场景已用到 S36，本变更用到 S39）

## [code] 代码实现
> 删后续自检（六维评分 → 大任务，垂直拆 3 片）：切片1（租约 + 中继，两缝各自契约自成闭环，删后续独立过 verify；端到端可观察——双连接竞争恰一胜者、双订阅同帧序）；切片2（派发 + runner 编排 + session-controller 接入，依赖切片1 的两缝属被依赖片排前，删切片3 后 verify 绿（kill-runner 接管、inbox 接续可观察））；切片3（staging 部署 + smoke 接入，端到端可观察——SMOKE-core-14/15 走通）。无横向片，无前向依赖。
- [x] 切片1：会话租约与流中继——新增 `packages/core/session-lease`（Service Definition：acquire/renew/release/ownerOf/waitLost）与 `packages/core/session-lease-postgres`（租约表 + 原子过期接管）；新增 `packages/core/stream-relay`（Service Definition：publish/subscribe）与 `packages/core/stream-relay-postgres`（`stream_relay_log` 表 + LISTEN/NOTIFY 唤醒 + 序号追赶）；嵌入式 Postgres 测试 helper 随包建立（复用 M2 模式，二进制缺失显式 skip）；同步 UT/ST + OpenLogos reporter（覆盖 UT-S37-01..05、UT-S39-01..04、ST-S37-01..03、ST-S39-01..02）
- [x] 切片2：派发队列与 runner 编排——新增 `packages/core/agent-dispatch`（队列表 + publish + Runner 编排循环：consume→acquire→`agents.resume`→waitLost 即 cancel→空闲 release）；`packages/api/session-controller` follow 数据面加 relay 增量源（冷读共享层后从 relay 追加）；同步 UT/ST + OpenLogos reporter（覆盖 UT-S38-01..05、ST-S38-01..03）
- [ ] 切片3：staging 部署与 smoke 接入——staging driver（共享 PG + runner A/runner B/副本进程，串行操作 + CPU 监控）；实现 smoke runner 支持 SMOKE-core-14（kill runner 接管续跑）与 SMOKE-core-15（双副本同看流），接入 `scripts/run-smoke.js`；完成后跑 smoke 覆盖预检（CPU 阈值约束下串行执行）

## [deploy] 部署任务
- [ ] 按更新后的部署方案在 staging 部署执行池：起共享 Postgres（免 root 二进制）→ runner A 与 runner B 进程指向同库 → kill 正在执行的 runner A → runner B 在租约过期内接管并接续 inbox 未消费输入 + 双副本同看流走通（SMOKE-core-14/15）
- [ ] 确认配置项、服务启动与回滚预案（停 runner/副本进程；staging 租约/队列/中继表随集群数据目录销毁）

# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — core-01-requirements.md：「三、场景总览」表追加 S40–S42 行（整表守恒携带既有 39 行）；「四、核心场景详述（P0）」新增 S40/S41/S42 详述；「5.3 不做清单」修订（MODIFIED 携带剩余全量：新增不做项——schedule 分布式版与单机版混用、webhook 消费独立编排器、K8s Operator）
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — core-01-feature-design.md：ADDED S40–S42 交互规格章节（共享到期派发、无状态入口、排空与滚动升级）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/` — core-system-map.md：ADDED「Host 本地服务分布式化」章节（`schedule_due`/`webhook_events` DDL、SKIP LOCKED 取用不变式、排空时序、HMR 只读禁用）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S40-schedule-dispatch.md（S40 场景时序图：到期恰一取用与投递）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S41-webhook-ingress.md（S41 场景时序图：入口入队与恰一建会话）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S42-drain-rolling-upgrade.md（S42 场景时序图：排空与接管）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — core-01-deployment-plan.md：MODIFIED「二、部署拓扑」「三、环境变量与密钥」「七、部署后检查清单」「八、冒烟测试方案」（各自携带既有全量条目）+ ADDED Host 本地服务条目（profile 镜像形态、DSH_CONFIG_READONLY、排空演练）
- [x] 产出 delta 文件到 `deltas/test/` — 新文档 core-S40-S42-test-cases.md（UT-S40..42 / ST-S40..42 用例 + AC 追溯表 + 验收执行资源约束）
- [x] 产出 delta 文件到 `deltas/test/smoke/` — core-smoke-test-cases.md：MODIFIED「二、冒烟测试用例」表追加 SMOKE-core-16/17/18（整表守恒携带既有 15 行）与「三、覆盖度校验」更新
- [x] 同步 `logos/logos-project.yaml` 的 `scenario_counter.next_id` 至 43（M3 场景已用到 S39，本变更用到 S42）

## [code] 代码实现

- [ ] 实现代码变更

## [deploy] 部署任务
- [ ] 按更新后的部署方案在 staging 部署 Host 本地服务分布式形态：起共享 Postgres（免 root 二进制）→ 双 runner/双副本指向同库 → 到期任务恰一交付 + webhook 恰一建会话 + 排空演练走通（SMOKE-core-16/17/18）；profile 镜像形态（固定层只读 + 用户层共享挂载 + `DSH_CONFIG_READONLY=1` 禁用 HMR）在演练中验证
- [ ] 确认配置项、服务启动与回滚预案（停 runner/副本进程；staging schedule/webhook 表随集群数据目录销毁）

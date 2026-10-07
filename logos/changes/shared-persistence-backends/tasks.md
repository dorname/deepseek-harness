# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — core-01-requirements.md：「三、场景总览」表追加 S34–S36 行（整表守恒携带既有 33 行）；「四、核心场景详述（P0）」新增 S34/S35/S36 详述；「5.3 不做清单」修订（MODIFIED 携带剩余全量）
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — core-01-feature-design.md：ADDED S34–S36 交互规格章节（共享会话世代读写、共享域数据命名空间、共享附件存取）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/` — core-system-map.md：ADDED「共享持久层」章节（三个新后端组件、DDL、命名空间注入与不变式）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S34-shared-session-generations.md（S34 场景时序图）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S35-shared-domain-namespace.md（S35 场景时序图）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S36-shared-attachments.md（S36 场景时序图）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — core-01-deployment-plan.md：MODIFIED「二、部署拓扑」「三、环境变量与密钥」「四、构建与发布命令」「五、数据迁移策略」「七、部署后检查清单」「八、冒烟测试方案」（各自携带既有全量条目）+ ADDED 共享持久层条目
- [x] 产出 delta 文件到 `deltas/test/` — 新文档 core-S34-S36-test-cases.md（UT-S34..36 / ST-S34..36 用例 + AC 追溯表 + 验收执行资源约束）
- [x] 产出 delta 文件到 `deltas/test/smoke/` — core-smoke-test-cases.md：MODIFIED「二、冒烟测试用例」表追加 SMOKE-core-12/13（整表守恒携带既有 11 行）与「三、覆盖度校验」更新

## [code] 代码实现
> 删后续自检（六维评分 11 → 大任务，垂直拆 3 片）：切片1（共享域 KV + 命名空间）删后续可独立过全量 verify（S35 用例自成闭环，embedded-postgres 测试 helper 随片建立自用），端到端可观察（双连接同库互不可见）；切片2（共享会话世代）删切片3 后 verify 绿（契约套 + ST 自成闭环，依赖切片1 的 helper 属被依赖片排前、非前向依赖），端到端可观察（双节点互见/崩溃恢复/写互斥）；切片3（共享附件/溢出 + smoke）收尾全规格落地，端到端可观察（跨节点取回 + SMOKE-core-12/13 接入）。无横向片（无独立"基建/接线/写测试"片），无前向依赖。
- [x] 切片1：共享域 KV 后端与每用户命名空间——新增 `packages/storage/storage-postgres`（`StorageBackend.kv`，表结构镜像 sqlite 物化习惯 + unit 版本戳），`storage-domain` 提供方按 `DSH_FLEET_USER_ID` 派生用户专属命名空间 unit 名（确定性安全编码进 `UNIT_NAME_RE`，冲突 loud fail；未注入走默认命名空间）；建立嵌入式 Postgres 测试 helper（`@embedded-postgres/linux-x64`，二进制缺失显式 skip）；同步 UT/ST + OpenLogos reporter（覆盖 UT-S35-01..05、ST-S35-01）
- [ ] 切片2：共享会话世代后端——新增 `packages/session/session-persistence-postgres`（继承 `SessionPersistence`，世代行 + 尾表 + advisory lock 写互斥 + 独占发布同事务，复用 `storage-contract` 校验原语）；接入既有缝契约套 `runPersistenceContract`（工厂含 reopen/corruptTail）与 `runLiveWritePathContract`；同步 UT/ST + OpenLogos reporter（覆盖 UT-S34-01..08、ST-S34-01..03）
- [ ] 切片3：共享附件/溢出后端与 smoke 接入——新增 `packages/attachment/attachment-postgres`（最小实现 imageLimits/validateImage/saveImage/readImage，命名空间随属主）与 `packages/spill/spill-postgres`（saveText 落共享表）；实现/更新 smoke runner 支持 SMOKE-core-12（双节点互见）与 SMOKE-core-13（命名空间互不可见），写 `logos/resources/verify/smoke-results.jsonl` reporter 并接入 `scripts/run-smoke.js`，完成后跑 smoke 覆盖预检（CPU 阈值约束下串行执行）；同步 UT/ST + OpenLogos reporter（覆盖 UT-S36-01..05、ST-S36-01..02；SMOKE-core-12/13 于 [deploy] 阶段在 staging 执行）

## [deploy] 部署任务
- [ ] 按更新后的部署方案在 staging（本地 staging 验证环境）部署共享持久层：起共享 Postgres（免 root 二进制）→ 两个 dsh Host 实例指向同库 → 双节点打开同一用户历史会话 + SMOKE-core-12/13 走通
- [ ] 确认配置项、服务启动与回滚预案（停双实例、保留或清理 staging 库）

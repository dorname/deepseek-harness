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
（本段在 plan 段留空：本提案需要代码实现，但 `[code]` 切片由 merge 后的 `slice-planner` 基于已合并规格和真实 UT/ST ID 统一规划。此处仅保留 `## [code]` 标题，勿提前填写切片项。）

## [deploy] 部署任务
- [ ] 按更新后的部署方案在 staging（本地 staging 验证环境）部署共享持久层：起共享 Postgres（免 root 二进制）→ 两个 dsh Host 实例指向同库 → 双节点打开同一用户历史会话 + SMOKE-core-12/13 走通
- [ ] 确认配置项、服务启动与回滚预案（停双实例、保留或清理 staging 库）

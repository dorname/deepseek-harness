# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — core-01-requirements.md：「三、场景总览」表追加 S31–S33 行（整表守恒携带既有 30 行）；「四、核心场景详述（P0）」新增 S31/S32 详述；「5.3 “不做”清单」修订（MODIFIED 携带剩余全量）
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — core-01-feature-design.md：ADDED S31–S33 交互规格章节（网关登录、跨用户隔离、进程生命周期）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/` — core-system-map.md：ADDED「fleet 部署形态」章节（dsh-gateway、dsh-fleet-manager 组件与隔离不变式）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S31-fleet-gateway-login.md（S31 场景时序图）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S32-cross-user-isolation.md（S32 场景时序图）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 新文档 core-S33-fleet-lifecycle.md（S33 场景时序图）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — core-01-deployment-plan.md：MODIFIED「二、部署拓扑」「三、环境变量与密钥」「四、构建与发布命令」「七、部署后检查清单」「八、冒烟测试方案」（各自携带既有全量条目）+ ADDED fleet 部署形态条目
- [x] 产出 delta 文件到 `deltas/test/` — 新文档 core-S31-S33-test-cases.md（UT-S31..33 / ST-S31..33 用例 + AC 追溯表 + 验收执行 CPU 资源约束）
- [x] 产出 delta 文件到 `deltas/test/smoke/` — core-smoke-test-cases.md：MODIFIED「二、冒烟测试用例」表追加 SMOKE-core-09..11（整表守恒携带既有 8 行，SMOKE-core-11 含 CPU 利用率上限）与「三、覆盖度校验」更新

## [code] 代码实现
（本段在 plan 段留空：本提案需要代码实现（dsh-gateway、dsh-fleet-manager 新组件；web-app 网关转发头配置与 anonymous-user-id fleet 身份注入两处小改），但 `[code]` 切片由 merge 后的 slice-planner 基于已合并规格和真实 UT/ST ID 统一规划。此处仅保留 `## [code]` 标题，勿提前填写切片项。）

## [deploy] 部署任务
- [ ] 按更新后的部署方案在 staging（本地 staging 验证环境）部署 fleet 形态：构建产物 → 启动 fleet 管理器与网关 → 双测试用户走通 SMOKE-core-09..11
- [ ] 确认配置项、服务启动与回滚预案（停 fleet 管理器并回收用户进程与 homes）

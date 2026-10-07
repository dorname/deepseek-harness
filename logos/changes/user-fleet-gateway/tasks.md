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
> 删后续自检（slice-planner）：六维打分 12（跨模块/状态机/契约变更/15+3 用例/部署安全/1 假设）→ 大任务。垂直拆 3 片（fleet 生命周期线 → 网关认证隔离线 → 部署编排与 smoke 线），逐片过删后续门：(a) 各片删后续后全量 verify 仅缺未实现片的 ID（specs 缺 ID 不判红，已上报结果须全绿）成立；(b) 各片均有端到端可观察能力（片1 生命周期管理与审计归属、片2 登录进专属 Harness、片3 SMOKE 全链路），无铺管道片；片 2/3 依赖片 1/2 的产物属串行顺序而非前向依赖。无合并。

- [x] 切片1 fleet 用户进程生命周期：新建 `packages/fleet/fleet-manager`（@deepseek-ai/dsh-fleet-manager）——进程注册表 `ensureProcess(subject)`、spawn `dsh --profile web`（OS 分配端口、注入该用户 `DSH_HOME` 与 fleet 身份 env）、空闲回收（home 保留）、崩溃重启（次数上限）、并发上限裁决（rejected(limit)）、结构化生命周期日志（provisioned/recycled/restarted/rejected）；小改 `packages/identity/anonymous-user-id` 支持读取 fleet 注入用户标识用于审计归属；同片 UT-S33-01/02/03、ST-S33-01/02 + OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`
- [x] 切片2 网关认证与跨用户隔离路由：新建 `packages/fleet/gateway`（@deepseek-ai/dsh-gateway）——OIDC 授权码流程（发现/回调/code 换 token，测试提供方可 mock）、网关会话 cookie、按身份经 fleet 注册表路由反代到用户进程 loopback 端口、跨用户归属判定 403 不转发、启动令牌仅回环内层；小改 `packages/bundle/web-app` startup 新增「信任 loopback 网关转发头」配置项；同片 UT-S31-01/02/03、UT-S32-01/02、ST-S31-01/02、ST-S32-01/02 + reporter
- [x] 切片3 fleet 部署编排与 smoke 闭环：本地 staging 部署编排（fleet-manager + gateway 启动配置与回滚脚本）、ST-S33-03 验收执行 CPU 约束 runner（小上限满载 + 串行执行 + CPU 峰值监控 ≤ 部署配置阈值）；实现/更新 smoke runner 覆盖 SMOKE-core-09/10/11（网关认证路由、双用户隔离抽查、生命周期与资源上限），结果写 `logos/resources/verify/smoke-results.jsonl`，接入 `logos.config.json` smoke 命令（`scripts/run-smoke.js`），完成后跑 smoke 覆盖预检

## [deploy] 部署任务
- [ ] 按更新后的部署方案在 staging（本地 staging 验证环境）部署 fleet 形态：构建产物 → 启动 fleet 管理器与网关 → 双测试用户走通 SMOKE-core-09..11
- [ ] 确认配置项、服务启动与回滚预案（停 fleet 管理器并回收用户进程与 homes）

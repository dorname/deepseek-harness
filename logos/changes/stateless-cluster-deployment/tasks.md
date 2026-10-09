# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — core-01-requirements.md：S42 详述扩展「编排器无关退出语义」（SIGTERM = 任意编排器的排空指令）；5.3 不做清单追加「不做编排器专属集成与多租户命名空间迁移」（MODIFIED 携带剩余全量）
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — core-01-feature-design.md：S42 交互规格补「编排器无关节」（配置化循环启动 + 信号排空）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/` — core-system-map.md：§12 扩展「编排器无关部署」小节（生命周期效果、支持矩阵、单租户声明）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — core-01-deployment-plan.md：MODIFIED「二、部署拓扑」「三、环境变量与密钥」（支持矩阵/DSH_CONFIG_READONLY 单租户/前端反代/循环配置化）
- [x] 产出 delta 文件到 `deltas/test/smoke/` — core-smoke-test-cases.md：MODIFIED「二、冒烟测试用例」追加 SMOKE-core-19（整表守恒携带既有 18 行）与「三、覆盖度校验」更新
- [x] 产出 delta 文件到 `deltas/test/` — core-S42-test-cases 扩展：以 MODIFIED 追加 UT-S42-06..07（循环生命周期）与 SMOKE 绑定行（新文档 core-S43-test-cases 不设，归 S42 域）

说明：S42 域扩展不新增场景编号（design-level 扩展），`scenario_counter.next_id` 保持 43。

## [code] 代码实现

- [ ] 实现代码变更

## [deploy] 部署任务
- [x] SMOKE-core-19：本地起双 runner 进程（配置化循环），向 A 发 SIGTERM——A 在 in-flight drive 到 turn 边界后排空退出（exit 0），B 继续取队列；SMOKE 账本记录

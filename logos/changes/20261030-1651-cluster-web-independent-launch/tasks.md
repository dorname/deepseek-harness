# 实现任务

## [delta] 规格变更
- [x] `deltas/prd/1-product-requirements/core-01-requirements.md`:S44 触发方式改为 `pnpm cluster-web:up`/部署脚本;S46/S47 的 API 进程组合机制改为 `dsh --profile cluster-web-api|cluster-web-runner`。
- [x] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`:S44/S46/S47 对应交互条目同步。
- [x] `deltas/prd/3-technical-plan/1-architecture/core-system-map.md`:新增 `dsh-cluster-web-app`、`dsh-cluster-web-runner-app` 两个 bundle 与两个 shipped profile 的组件行;组合层次图(base→web-app→cluster-web-app→cluster-web-runner-app)。
- [x] `deltas/prd/3-technical-plan/1-architecture/core-entry-points.md`:CLI 面变更——移除 `dsh up` 与 `--api-only`,新增 `dsh --profile cluster-web-api|cluster-web-runner`(并补 acp-network 行)。
- [x] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`:compose/进程树/Helm 三路径的 dsh 调用面改 profile;overlay 渲染机制移除;无 Postgres 路径改为 `no-postgres.patch.yml` 调用期覆盖。
- [x] `deltas/test/`(smoke 用例表 + `core-S46-test-cases.md`):组合断言更新(PG 行来自 bundle、`DATABASE_URL` 缺失启动即败、no-postgres 复活 JSONL)。

## [code] 代码实现
> 切片1:bundle 与 profile 注册(被依赖片);切片2:deploy/ 与 CLI 面切换(依赖切片1);切片3:文档、gate 与升级指南(依赖切片2)。

- [x] 切片1:两个 bundle 包 + profile 注册
  - `packages/bundle/cluster-web-app`:包脚手架(命名/JSDoc/README 按 adding-a-package);`cordis.patch.yml` **整段重述** `web-runtime` 行的全部 config 键并置 `serveFrontend: false`(patch 替换整段 config,不可只写单键)、disable `session-persistence-jsonl`、insert `session-persistence-postgres`(`connectionString: !!js process.env.DATABASE_URL`, `max: 2`)与 `stream-relay-postgres`;REAL-composition 测试(Loader 真组合,断言行集合与 `web-runtime` 键完整性;`DATABASE_URL` 缺失时启动失败)。
  - `packages/bundle/cluster-web-runner-app`:增量 patch(insert `session-lease-postgres`、`agent-dispatch`,`connectionString`/`nodeId` 经 `!!js`);同上测试。另修复既有契约漂移:旧 runner overlay 未设 `runner: true`(循环从未运行),新 patch 按 `agent-dispatch` 当前 Config 契约(`runner: true` + `nodeId`,缺 `DSH_NODE_ID` 挂载即抛错)。
  - `packages/boot/app-boot/src/profile.ts`:`PROFILE_TEMPLATES` 增 `cluster-web-api`、`cluster-web-runner`(profile.spec.ts 精确钉住两模板)。
  - `apps/cli/package.json`:两个 bundle 的 `workspace:*` 运行时依赖。
  - `packages/bundle/web-app`:`startup.ts` 删 `--api-only`/`serveFrontend` 字段与示例;`web-runtime` 行 `serveFrontend` 改字面量 `true`;`tests/startup.spec.ts` 同步(未知选项退出 1)。
- [x] 切片2:deploy/ 与 CLI 切换
  - `deploy/cluster-web/api.mts`、`supervise.mts`:dsh 调用改 `--profile cluster-web-api|cluster-web-runner`;删除 `--api-only`、`--patch` overlay 渲染与 `process-helpers.mts` 的 renderOverlay 机制;`frontend.mts` 改纯 `--profile web`,删 `shell.overlay.yml`。
  - 无 Postgres 路径:`overlays/no-postgres.patch.yml`(disable 两个 PG 行、re-enable `session-persistence-jsonl`),仅无 `DATABASE_URL` 时附加;re-enable 语义已在 `vendor/include/src/index.ts:120-123` 证实(逐键无条件赋值)。
  - `apps/cli/src/args.ts`/`bin.ts` 删 `up` 模式,删 `apps/cli/src/up.ts`;根 `package.json` 增 `cluster-web:up` + `ROOT_LAUNCHER_POLICIES` 的 `dsh-wrapper` 行。
  - Helm:`chart/templates/runner-deployment.yaml` 改 `--profile cluster-web-runner` + `DSH_NODE_ID`(fieldRef `metadata.name`);chart README 同步。
  - smoke 脚本更新:五个 `smoke-cluster-web-*.ts` 全部改 profile 断言;`fe-be-containers` 改为动态空闲端口(见下)。
  - 计划外修复:compose `ports` 改 `'${EDGE_PORT:-8080}:${EDGE_PORT:-8080}'` 对称映射(原宿主/容器侧脱节,`EDGE_PORT≠8080` 时发布必断),`.env.example` 注明;SMOKE-core-24 改用 freePort 并同步 `EDGE_PORT`/`PUBLIC_URL`/`TRUSTED_HOST`(宿主机 8080 被无关静态服务占据时,就绪探测打到错误服务器并报误导性"expected 303")。
- [x] 切片3:文档、gate、升级指南
  - `docs/architecture.md`(+zh):shipped profiles 列表补 `acp-network`(修既有脱节)+ 两个新 profile;模板清单收敛为指向 Application launch 一节(词数预算内消除重复事实)。
  - `docs/user/guide/public-deployments.md`(+zh):API 进程条目去 `--api-only`。
  - `deploy/cluster-web/README.md`(+zh、i18n.yaml)。
  - `scripts/verify-application-entrypoints.ts`:`DEPLOY_ENTRY_CLASSIFICATIONS` 按路径分类 `deploy/**/*.mts`(含 spec:未分类拒绝/缺失上报;`process-helpers.mts` 为共享模块)。
  - 升级指南两项(dsh-create-upgrade-guide):`docs/upgrade-guide/v0.2.1-alpha.1/web-api-only-flag-removed/`、`dsh-up-command-removed/`。
  - Agent Note:`.agents/notes/implemented/architecture/2026-10-30-cluster-web-named-profiles.md`(+zh、i18n.yaml)。

## [verify] 验证
- [x] `pnpm run typecheck`(通过);`pnpm run lint` 唯一失败为既有 `scripts/smoke-acp-network.ts:66`(干净 HEAD 同款,非本变更)。
- [x] 聚焦单测:web-app startup、两个新 bundle 包套件、app-boot profile、cli args、verify-application-entrypoints(6 文件 120 测试通过)。
- [x] `pnpm run build && pnpm run hygiene`(切片1/2 时段通过;其后仅改文档/脚本/测试,包面未动)。
- [x] `pnpm run test:coverage`(切片1/2 时段通过;其后 `packages/*/*/src` 无改动)。
- [x] 快照:`pnpm run test:snapshot` 180/183 通过;唯一失败 `browser-use-stagehand-native`(fixture 的 Node load-hook 返回 undefined,属既有 browser-use 家族环境故障);无快照钉住 `--api-only`;`test:expected` 4 个失败经干净 HEAD 对照确认为既有(同款失败)。
- [x] SMOKE-core-20/21/23/24 全部通过(20:5.4s;21、23 早前通过;24:375s 容器端到端含 token→cookie→/→/api)。
- [x] SMOKE-core-22 通过(helm template + chart 断言)。
- [x] `doc-sync` 41 项中 37 通过;4 失败均为已合入 acp 工作的既有问题(`packages/acp/*` JSDoc/配置目录、其级联 plugin-packages、`deployment-report.md` 镜像 tag 哈希),非本变更引入;本变更顺带修复 `gen-tsconfig-paths` 过期(补齐 acp-network 别名)。`verify-application-entrypoints` 通过。

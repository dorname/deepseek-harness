# 合并指令

## 变更提案
- 提案名称：20261030-1651-cluster-web-independent-launch
- 提案目录：logos/changes/20261030-1651-cluster-web-independent-launch/

## 提案内容

# 变更提案:cluster-web 独立启动对齐(独立 profile,移除对 `dsh --profile web` 的启动期覆盖)

> module: core | created: 2026-10-30

## 变更原因

仓库两条部署线现在分叉在两种启动范式上:

- **acp-network**(20261020-1643,已落地)走独立启动:专属能力包 + 专属 bundle(`packages/bundle/acp-network-app`,环境值直接 `!!js process.env.*` 读入行 config)+ shipped profile 注册(`packages/boot/app-boot/src/profile.ts:183`),容器 PID 1 就是 dsh(`CMD ["node","apps/cli/lib/bin.js","--profile","acp-network"]`)。
- **cluster-web** 走启动期覆盖:所有进程都是 `dsh --profile web` 再改造——
  - `--api-only` 是为 cluster-web 专门加进 web profile 公开 CLI 面的 flag(`packages/bundle/web-app/src/startup.ts:74`,help 文本点名 cluster-web),而 `overlays/api.overlay.yml` 同时又写 `serveFrontend: false`——两个机制表达同一个事实;
  - `__DATABASE_URL__` 运行时字符串替换渲染 `--patch` 文件,重新实现了 bundle config 里 `!!js process.env.DATABASE_URL` 原生能力;
  - `dsh up`(`apps/cli/src/up.ts`)把部署编排子命令焊进产品 CLI,但依赖 `deploy/cluster-web/supervise.mts` 且只在源码 checkout 存在——发布安装里是必然报错的死命令;acp-network 的等价物在 `deploy/acp-network/scripts/`。

这抵触 `docs/architecture.md:45`("custom plugin composition remains a profile plus ordered patch files, not another executable or inline application tree"):API/runner 角色就是自定义插件组合(web − frontend − JSONL 持久化 + Postgres 行),却靠启动期改写实现。

历史说明:20261012-0112(cluster-web-dsh-up)曾明确记录"接到 `dsh up` 子命令、非新 profile"。该决策早于 acp-network 确立的独立 profile 先例,且未预见发布安装中 `dsh up` 必然失效的问题;S46 选 overlay 是当时以"回滚=删 overlay"为诉求的增量路径,归档中无"不做独立 profile"的论证。本变更以上述新证据推翻它。

另修复既有文档脱节:`architecture.md:45` shipped profiles 列表至今漏 `acp-network`(20261020-1643-acp-over-network 归档变更引入时未更新)。

## 变更类型

架构级 + 代码级 + 对外可见破坏性变更(移除 `dsh --profile web --api-only` flag;移除 `dsh up` 子命令;新增两个 shipped profile)。需升级指南。

## 变更范围

- 影响的需求文档:`core-01-requirements.md` S44(触发方式从 `dsh up` 改为部署脚本/仓库脚本)、S46/S47(API 进程组合机制从 `--api-only`+overlay 改为独立 profile)。
- 影响的功能规格:`core-01-feature-design.md` 对应 S44/S46/S47 条目。
- 影响的技术方案:`core-01-deployment-plan.md`(profile 化启动、overlay 机制移除)、`core-system-map.md`(新增两个 bundle/profile)、`core-entry-points.md`(CLI 面移除 `dsh up` 与 `--api-only`、新增两个 profile)。
- 影响的入口点:`dsh --profile cluster-web-api`、`dsh --profile cluster-web-runner` 成为 shipped profiles;`--api-only` 与 `dsh up` 从 CLI 面移除。
- 影响的 API / DB:无(协议面、表结构不变)。
- 影响的编排测试:无。
- 影响的 smoke:SMOKE-core-20/21/23/24(触发命令与组合断言更新;SMOKE-core-21 触发从 `dsh up` 改为等价部署脚本)。
- SDK 投影:无需变更(agent-loop、session-lifecycle、`SessionEventMap` 均不动)。

新组件:

1. `packages/bundle/cluster-web-app`(`@deepseek-ai/dsh-cluster-web-app`):cluster-web 共享组合 bundle——`cordis.patch.yml` 叠在 `@deepseek-ai/dsh-web-app` 之上:`web-runtime` 行整行重述并置 `serveFrontend: false`;`session-persistence-jsonl` 置 disabled;insert `session-persistence-postgres`(`connectionString: !!js process.env.DATABASE_URL`)与 `stream-relay-postgres`。
2. `packages/bundle/cluster-web-runner-app`(`@deepseek-ai/dsh-cluster-web-runner-app`):纯增量 bundle——在上述之上 insert `session-lease-postgres` 与 `agent-dispatch`(connectionString/nodeId 经 `!!js` 读环境)。

shipped profile 模板注册:

- `cluster-web-api`: `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-cluster-web-app']`
- `cluster-web-runner`: `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-cluster-web-app', '@deepseek-ai/dsh-cluster-web-runner-app']`

既有包/目录改动:

- `packages/bundle/web-app/src/startup.ts`:删 `--api-only` 选项、`WebStartupValues.serveFrontend` 字段与示例行;`web-runtime` 行的 `serveFrontend` 改为字面量 `true`(config 键保留,由 cluster bundle 覆盖为 `false`);`tests/startup.spec.ts` 同步。
- `packages/boot/app-boot/src/profile.ts`:`PROFILE_TEMPLATES` 增两模板项。
- `apps/cli/package.json`:增两个 bundle 的 `workspace:*` 运行时依赖。
- `apps/cli/src/args.ts` / `bin.ts` / `up.ts`:删 `up` 模式与子命令。
- 根 `package.json`:增 `cluster-web:up` 脚本(直跑 `deploy/cluster-web/supervise.mts`,保住"一键、无 Docker"的 S44 诉求),并按 `verify-application-entrypoints` 的 `ROOT_LAUNCHER_POLICIES` 加 `dsh-wrapper` 行。
- `deploy/cluster-web/`:`api.mts`/`supervise.mts` 的 dsh 调用改 `--profile cluster-web-api|cluster-web-runner`;`frontend.mts` 改纯 `--profile web`(shell.overlay.yml 本就是默认值重述,删除);删除 `overlays/api.overlay.yml`、`overlays/runner.overlay.yml` 及 `process-helpers.mts` 的 overlay 渲染机制;Helm chart 的 api/runner deployment 命令行与 configmap overlay 模板同步。
- `scripts/verify-application-entrypoints.ts`:新增 `deploy/**/*.mts` 作用域,该作用域内**入口脚本本身**(不论有无 shebang)必须持有显式分类行——`edge/forward/upstream/supervise/frontend/api` 分类为 "deployment orchestration proxy, not a Harness application"。现脚本只对 `#!` 开头的文件生效(`executableSourceViolations` 的 `source.startsWith('#!')`),而 deploy 下脚本均经 `node --import tsx/esm` 调起、无 shebang,故本项是 gate 语义的扩展,不是模式列表的机械追加。
- `docs/architecture.md`:shipped profiles 列表补 `acp-network`(修既有脱节)与两个新 profile;`docs/user/guide/public-deployments.md`(及 zh)API 进程条目从 `--api-only` 改为独立 profile / `serveFrontend: false` patch;`deploy/cluster-web/README(.zh).md`、chart README 更新。
- 升级指南两项(`docs/upgrade-guide/`,按 dsh-create-upgrade-guide):`--api-only` 移除(外部前置部署改 `serveFrontend: false` patch 或 cluster-web-api profile);`dsh up` 移除(源码 checkout 用 `pnpm cluster-web:up` / Compose / Helm)。

## 部署影响

- 是否需要部署:是(compose 与进程树两条路径都要验证新 profile 启动)。
- 部署原因:SMOKE-core-20/23/24 需真实拉起 frontend/api 并经同域入口完成 token→cookie→`/api`;镜像内 dsh 调用面全部变更。
- 影响环境:本地 staging(compose + Docker-free 进程树);Helm 走 `helm template` 校验(SMOKE-core-22)。
- 是否涉及数据迁移:否(持久化行集合不变,仅组合位置从启动期 overlay 移入 bundle)。
- 是否需要回滚预案:是;回退镜像/模板 revision 即回到 `--api-only`+overlay 形态。
- 是否需要 smoke:是(既有 SMOKE-core-20/21/23/24 更新,不新增编号)。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

1. **角色组合入 bundle,启动面归零改写**:API/runner 的组合差异(web−frontend−JSONL+PG 持久化/relay;runner 再 +lease/dispatch)全部落进两个 bundle 的 patch 行;容器与 supervisor 只传 invocation flag(`--host 127.0.0.1 --port --public-url --trusted-host --no-open`)。环境值经行内 `!!js` 读入;`DATABASE_URL` 缺失时由插件 Config 校验启动即失败(误配置大声失败)。
   机制已验证:loader 对目标行做的是逐键无条件赋值(`vendor/include/src/index.ts:120-123`),故后层 bundle 可整段替换 `web-runtime` 行的 `config`、也可将先前层置 disabled 的行重新置回 `false`;`serveFrontend` 的消费者经全仓排查仅 web-app 自身(patch 行、`WebStartupValues`、插件 Config `z.boolean().default(true)`),无外部依赖。注意 patch 替换的是整段 `config`,cluster bundle 必须重述 `web-runtime` 行拥有的全部键,不能只写 `serveFrontend: false`。
2. **`--api-only` 移除**:该 flag 唯一消费者是 cluster-web;`serveFrontend` 仍是 `web-runtime` 行的 config 键,外部前置部署用 patch 或 profile 置 false(公开文档本就并列两种写法)。
3. **`dsh up` 移出产品 CLI**:等价入口下沉为 `deploy/cluster-web` 的部署脚本 + 仓库级 `cluster-web:up` 包装,与 acp-network 的 `scripts/` 同构;发布安装不再携带死命令。
4. **无 Postgres 本地路径**:`--skip-overlays` 语义保留但改实现——`deploy/cluster-web/overlays/no-postgres.patch.yml`(disable 两个 PG 行、re-enable `session-persistence-jsonl`),仅在无 `DATABASE_URL` 时由 supervisor 以 `--patch` 附加。这是对已定组合的调用期覆盖(patch 的文档化用途),不是又一处组合定义;re-enable 的可行性已从 loader 合并代码证实(见上),实现时以用例钉住该行为。
5. **gate 覆盖 deploy/**:`verify-application-entrypoints` 把 `deploy/**/*.mts` 纳入显式分类,防止下一个人再往 deploy/ 塞裸 Node 服务而 gate 不可见。

范围裁剪:

- 不改 shell 侧:`frontend.mts` 的 shell 就是未修改的 `dsh --profile web`,本就合规。
- 不动 edge/forward/upstream 代理与 supervise 的编排职责(等同 acp-network 的 k8s manifests,是拓扑编排,不是 Harness 应用)。
- 不引入第三 profile、不做 env 角色开关(显式组合优于隐式开关,先例:acp 与 acp-network 相邻两 profile)。
- 不改 SDK/Python 投影与 SessionEventMap。

## 验收资源约束

- 本地 staging,沿用 cluster-web 既有 CPU/副本约束:`API_REPLICAS≤2`、`RUNNER_REPLICAS≤2`、串行 smoke、CPU 峰值不超部署配置阈值。
- 两个新 bundle 包需 REAL-composition 测试(test-only `cordis.yml` 经 Loader 真实组合,非手搭 `ctx.plugin`),断言行集合与 `DATABASE_URL` 缺失时的失败行为。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/20261030-1651-cluster-web-independent-launch/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/20261030-1651-cluster-web-independent-launch/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/core-entry-points.md

- Delta 文件：`logos/changes/20261030-1651-cluster-web-independent-launch/deltas/prd/3-technical-plan/1-architecture/core-entry-points.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/20261030-1651-cluster-web-independent-launch/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/20261030-1651-cluster-web-independent-launch/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/test/core-S46-test-cases.md

- Delta 文件：`logos/changes/20261030-1651-cluster-web-independent-launch/deltas/test/core-S46-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/20261030-1651-cluster-web-independent-launch/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(20261030-1651-cluster-web-independent-launch): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive 20261030-1651-cluster-web-independent-launch`。

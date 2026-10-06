# core 入口点清单（entry-points）

> **逆向基线声明**：本文档是 brownfield-adopter（S33）逆向扫描产出的**现状快照**，不是权威意图文档。所有事实均可从代码与随仓文档验证；候选一律 `verified: false`（冻结字段）。扫描基线：`dsh` 0.2.1-alpha.1（`origin/master`，commit `5badb15009`），扫描日期 2026-10-06。

## 1. npm 主包与可执行入口

- 公开发布主包：`@deepseek-ai/dsh`（`apps/cli`），`bin` 字段 `"dsh": "lib/bin.js"`（`apps/cli/package.json:2,14-15`）。
- 根包 `@deepseek-ai/dsh-root` 无 `bin`；根 `scripts.dsh` = `node --import tsx/esm apps/cli/src/bin.ts`，仅本地开发入口（`package.json:198`）。
- 启动器函数 `runCli()`（`apps/cli/src/bin.ts:26`）；参数解析 `parseDshArgs()`（`apps/cli/src/args.ts:146`）。
- 应用启动规则：受支持的 Node 应用只能经具名 `dsh` profile 启动；`verify-application-entrypoints` 脚本门控任何绕过 `dsh` 的 Node 应用路径（`docs/architecture.md` §Application launch、AGENTS.md）。

## 2. CLI 命令表面

| 命令 / flag | 语义 | 证据 |
|---|---|---|
| `dsh <name>` | 位置参数简写 = `--profile <name>`（`plugin` 保留） | `apps/cli/src/args.ts:202-204` |
| `dsh --profile <name>` | 启动指定 profile | `apps/cli/src/args.ts:168` |
| `dsh --from-default-profile <name>` | 用内置模板初始化缺失 profile | `apps/cli/src/args.ts:169` |
| `dsh --patch <path>` | 追加 patch overlay，可重复 | `apps/cli/src/args.ts:170` |
| `dsh --dump-config` | 打印组合后配置并退出 | `apps/cli/src/args.ts:171` |
| `dsh --dump-config-schema` | 输出 profile/patch JSON Schema | `apps/cli/src/args.ts:172` |
| `dsh --dump-default-config` | 仅打印 bundle 层配置 | `apps/cli/src/args.ts:173` |
| `dsh plugin --profile <name> [args...]` | 将剩余参数转发给 profile 目录内 pnpm（add/list/remove/why 等） | `apps/cli/src/args.ts:187-199`、`apps/cli/src/bin.ts` |
| `dsh -V, --version` | 输出版本号 | `apps/cli/src/args.ts:154` |
| `[args...]` | 启动器不认识的参数原样透传给被启动 app | `apps/cli/src/args.ts:167` |
| `desktop` profile 保留 | CLI 默认禁止直接启动/管理，除非 `manageDesktopProfile=true` | `apps/cli/src/args.ts:83-87`、`apps/cli/src/bin.ts:16-19` |

## 3. 内置 profile 与 app 级 flag

| profile | bundle 包 | app 级 flag | 证据 |
|---|---|---|---|
| `web` | `@deepseek-ai/dsh-web-app` | `--host`、`--port`、`--public-url`、`--trusted-host`、`--no-open` | `packages/bundle/web-app/src/startup.ts:59-63` |
| `headless` | `@deepseek-ai/dsh-headless` | 位置参数 `[task...]`、`--json`、`--session-id` | `packages/bundle/headless/src/startup.ts:43-45` |
| `sdk` | `@deepseek-ai/dsh-sdk-app` | 无选项；绑定 stdin EOF 生命周期 | `packages/bundle/sdk-app/src/index.ts:38-47` |
| `sdk-minimal` | `@deepseek-ai/dsh-sdk-minimal` | 无 CLI 代码，纯 patch-only bundle | `packages/bundle/sdk-minimal/src/index.ts:1-9` |
| `acp` | `@deepseek-ai/dsh-acp-app` | 无选项；绑定 stdin EOF 生命周期 | `packages/bundle/acp-app/src/index.ts:25-34` |
| （公共底层） | `@deepseek-ai/dsh-base` | 所有 base-backed profile 的第一层 patch | `packages/bundle/base/package.json:31-34` |

## 4. apps 入口

| 应用 | 包名 | 入口 | 职责 |
|---|---|---|---|
| `apps/cli` | `@deepseek-ai/dsh`（public） | `src/bin.ts` → `lib/bin.js` | dsh CLI：profile 启动、插件管理、配置检视 |
| `apps/desktop` | `@deepseek-ai/dsh-desktop`（private） | `src/main.ts` → `lib/main.js` | Electron 桌面壳：窗口、协议、生命周期 |
| `apps/desktop-host` | `@deepseek-ai/dsh-desktop-host`（private） | `src/index.ts` → `lib/index.js`；另有 `src/cli.ts` | Electron Node-mode 宿主进程，desktop profile 的实际运行容器 |
| `apps/web` | `@deepseek-ai/dsh-web-frontend`（public） | vite 构建 `dist/`，由 `dsh web` 伺服 | Web 前端入口（基于 `dsh-client-web`） |

## 5. SDK 与原生入口

- **TypeScript SDK**：`@deepseek-ai/dsh-sdk-client`（高层 `DeepSeekHarness` turns API + 低层 `HarnessClient`），解析同版本 `dsh` 依赖并选择 `sdk` profile（`packages/sdk/README.md`、`docs/architecture.md` §Application launch）。
- **Python SDK**：PyPI `deepseek-harness-sdk`，导出 `DeepSeekHarness`（`python/sdk/src/deepseek_harness/api.py:49`）与 `HarnessClient`（`client.py:39`）；经 `subprocess.Popen` 启动 runtime 并在 stdio 上跑 newline-delimited JSON-RPC（`client.py:80`）。
- **Python runtime wheel**：PyPI `deepseek-harness-runtime-bin`，控制台脚本 `dsh = deepseek_harness_runtime:main`（`python/sdk-runtime/pyproject.toml:21`）；单文件可执行入口 `runtime-bootstrap.mjs` 导入 `@deepseek-ai/dsh/lib/bin.js` 调 `runCli()`（`runtime-bootstrap.mjs:37-38`）。
- **原生**：`@deepseek-ai/node-addon-system` 导出 `./landlock-run`（`launcherPath`、`grantArgs`、`probe`）与 `./flock`（`tryLockExclusive`）（`native/system/packages/entry/package.json:11-19`、`src/index.ts`）。

## 6. HTTP 路由入口

- `POST /github`：`webhook-github` 的签名 GitHub webhook 接收端点，校验签名后交 `ctx.webhookRuntime` 创建 Workspace Session（`packages/webhook/webhook-github/README.md`、`docs/user/guide/github-review.md`）。

## 逆向基线来源
```yaml
candidates:
  - key: core::1c6358931a5b
    anchor: cli:dsh --from-default-profile
    display: 用内置模板初始化缺失 profile
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::275ea0ef5610
    anchor: cli:dsh --patch
    display: 追加 patch overlay（可重复）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::2be0a70e0b8a
    anchor: cli:dsh --dump-config-schema
    display: 输出 profile/patch JSON Schema
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::35797efdf8cc
    anchor: cli:dsh sdk-minimal
    display: 最小 SDK profile
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::3989d9295211
    anchor: cli:dsh --dump-config
    display: 打印组合后配置并退出
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::3e0a62fe1433
    anchor: cli:dsh
    display: dsh CLI 启动器（apps/cli，bin lib/bin.js）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::3fa191e6b91f
    anchor: symbol:runCli
    display: CLI 启动函数（apps/cli/src/bin.ts:26）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::45a79e8740f6
    anchor: sdk:python deepseek_harness.HarnessClient
    display: Python JSON-RPC 客户端
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::525213db4f28
    anchor: cli:dsh --dump-default-config
    display: 仅打印 bundle 层配置
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::67453f02b2d8
    anchor: cli:dsh sdk
    display: SDK JSON-RPC stdio profile
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::78b6eafea49f
    anchor: app:dsh-desktop-host
    display: Electron Node-mode 宿主进程（apps/desktop-host）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::81a5a46d6679
    anchor: bin:deepseek-harness-runtime-bin dsh
    display: Python runtime wheel 控制台脚本
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::82c32e94c4f8
    anchor: cli:dsh web
    display: Web GUI profile 简写启动
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::848f39f3f3d8
    anchor: cli:dsh --version
    display: 输出版本号
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::8de3f2eb23e8
    anchor: app:dsh-desktop
    display: Electron 桌面壳（apps/desktop）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::8f726cda2262
    anchor: sdk:typescript @deepseek-ai/dsh-sdk-client
    display: TypeScript SDK 客户端包
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::9187719ede5a
    anchor: app:dsh-web-frontend
    display: Web 前端构建入口（apps/web）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::94e5d43a4c76
    anchor: sdk:python deepseek_harness.DeepSeekHarness
    display: Python 高层 API 类
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::975cac7609b5
    anchor: cli:dsh headless
    display: 一次性无头任务 profile
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::9a1d53aba5a6
    anchor: cli:dsh plugin
    display: profile 插件管理（转发 pnpm）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::b20c9637f753
    anchor: cli:dsh acp
    display: ACP 自动化服务器 profile
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::c84414c3dec0
    anchor: symbol:parseDshArgs
    display: CLI 参数解析（apps/cli/src/args.ts:146）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::caf942e40b71
    anchor: cli:dsh --profile
    display: 指定 profile 启动
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::d2738d4f68ba
    anchor: native:node-addon-system ./landlock-run
    display: Landlock 沙箱启动器导出
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::ef8aa05fb424
    anchor: route:/github
    display: GitHub webhook HTTP 端点（webhook-github）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::f7652382e9d4
    anchor: native:node-addon-system ./flock
    display: 异步 POSIX flock 导出
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
```

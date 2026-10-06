# core 依赖地图（dependency-map）

> **逆向基线声明**：本文档是 brownfield-adopter（S33）逆向扫描产出的**现状快照**，不是权威意图文档。所有事实均可从代码与随仓文档验证；候选一律 `verified: false`（冻结字段）。扫描基线：`dsh` 0.2.1-alpha.1（`origin/master`，commit `5badb15009`），扫描日期 2026-10-06。

## 1. 分层依赖模型

依赖方向自上而下（上层可依赖下层，反向禁止）：

| 层 | 内容 | 事实来源 |
|---|---|---|
| 应用启动层 | `apps/cli`（`@deepseek-ai/dsh`）、`apps/desktop`、`apps/desktop-host`、`apps/web` | 各 `apps/*/package.json` |
| Web 浏览器层 | `client/` 63 包 + `apps/web` | `packages/README.md` |
| bundle 组合层 | `bundle/` 6 包（`dsh-base`、`dsh-web-app`、`dsh-headless`、`dsh-sdk-app`、`dsh-sdk-minimal`、`dsh-acp-app`） | `docs/architecture.md` §Profiles and bundles |
| 进程外 SDK 层 | `sdk/`（TS）+ `python/`（Python） | `packages/sdk/README.md`、`python/sdk/README.md` |
| 能力缝层 | `fs/`、`shell/`、`llm/`、`subagent/`、`terminal/`、`sandbox/`、`lsp/`、`skill/`、`web/`、`workflow/`、`jobs/` 等能力族 | `packages/README.md` |
| 产品 API 脊柱 | `core/`（session、system-prompt、tools、agent、agent-loop、scope 等 8 包） | `docs/architecture.md` §Core packages |
| 零依赖工具层 | `util/` 17 包（`Branded<B>`、路径、超时、保留等） | `packages/README.md` |
| 原生原语层 | `native/` `@deepseek-ai/node-addon-system`（landlock-run、flock） | `native/system/packages/entry/package.json` |
| 框架层 | `vendor/cordis`（vendored Cordis 源码，rescope 为 `@deepseek-ai/cordis`） | `vendor/README.md`、`AGENTS.md` |

## 2. 在册依赖规则

1. **扩展插件只依赖 Service Definition，永不依赖具体 Provider**：`dsh-agent-loop` 可替换；UI、hook、工具插件使用 `dsh-agent`（`packages/README.md` §Dependencies）。
2. **组合 bundle 可依赖脊柱插件**（`packages/README.md` §Dependencies）。
3. **依赖图是生成物**：`docs/module-graph.md` 由 `pnpm run gen-module-graph` 生成，CI 保鲜门控（`packages/README.md` §Dependencies）。
4. **vendor rescope + peerDependency**：vendored 包 rescope 且 `private: true`；`@deepseek-ai/cordis` 是每个 harness 包的 peerDependency（+ dev）（`AGENTS.md` §Conventions、`docs/rescope.md`）。
5. **ESM everywhere**：全仓 `"type": "module"`；跨包用包名引用，本地相对导入带 `.ts`；`dsh` CLI 源码启动经 tsx ESM-only hook（`node --import tsx/esm`），可达模块必须保持 ESM（`AGENTS.md` §Conventions）。
6. **Python 运行时闭包**：`python/sdk-runtime` 以 `dsh-python-runtime-closure` 为依赖闭包根，把普通 `dsh` CLI 打进平台 runtime wheel；Python 客户端默认以显式 Harness home 启动 `dsh --profile sdk`（`docs/architecture.md` §Application launch、`python/sdk-runtime/pyproject.toml`）。

## 3. 关键依赖方向证据

- Client（浏览器半）经 `ctx.remote`（Typert RPC 网关）调用 Host 能力，不直接依赖 Host 服务实现（`api/`、`typert/` 组）。
- SSH 族（`fs-ssh`、`subprocess-ssh`、`sandbox-ssh`）共享 `ctx.ssh` 连接助手，把 fs/subprocess/sandbox 三族 provider 指向远程 POSIX 主机而无需 fork provider（`packages/ssh/README.md`、`docs/architecture.md` §Capability seams）。
- `sdk-minimal` 是有意的例外：一个 bundle 拥有完整显式 SDK 树，不应用 `dsh-base`（`docs/architecture.md` §Profiles and bundles）。

## 逆向基线来源

```yaml
candidates:
  - key: "core::17a10abb4853"
    anchor: "layer:vendor-cordis"
    display: "框架层：vendored Cordis（vendor/cordis）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::eb189904fd06"
    anchor: "layer:util"
    display: "零依赖工具层（util/）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::cc4971f65534"
    anchor: "layer:core-spine"
    display: "产品 API 脊柱（core/）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::acca6780caa6"
    anchor: "layer:capability-seams"
    display: "能力缝层（fs/shell/llm/subagent/…）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::c91fd8f80459"
    anchor: "layer:bundle-profiles"
    display: "bundle 组合层（bundle/）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::02ce34bcc018"
    anchor: "layer:apps"
    display: "应用启动层（apps/）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::10023d3ff2ed"
    anchor: "layer:client-web"
    display: "Web 浏览器层（client/ + apps/web）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::ea11f175e706"
    anchor: "layer:sdk"
    display: "进程外 SDK 层（sdk/ + python/）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::bc5bc38a74f3"
    anchor: "layer:native"
    display: "原生系统原语层（native/）"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::d779d247925b"
    anchor: "rule:service-definition-only"
    display: "扩展插件只依赖 Service Definition，不依赖具体 Provider"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::fd3b45833a4b"
    anchor: "rule:composition-bundle-spine"
    display: "组合 bundle 可依赖脊柱插件"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::86937723af88"
    anchor: "rule:generated-module-graph"
    display: "docs/module-graph.md 由 pnpm run gen-module-graph 生成并 CI 保鲜"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::b6b4e6394a76"
    anchor: "rule:rescope-vendored-peer"
    display: "vendor 包 rescope；@deepseek-ai/cordis 为全仓 peerDependency"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::6604d875c0f4"
    anchor: "rule:esm-only"
    display: "ESM everywhere；dsh 源码启动经 tsx ESM-only hook"
    state: active
    verified: false
    aliases: []
    superseded_by: []
  - key: "core::eb2ab9469791"
    anchor: "dep:python-runtime-closure"
    display: "Python wheel 经 dsh-python-runtime-closure 打包 dsh CLI 依赖闭包"
    state: active
    verified: false
    aliases: []
    superseded_by: []
```

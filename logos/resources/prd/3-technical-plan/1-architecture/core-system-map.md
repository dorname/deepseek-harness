# core 系统地图（system-map）

> **逆向基线声明**：本文档是 brownfield-adopter（S33）逆向扫描产出的**现状快照**，不是权威意图文档。所有事实均可从代码与随仓文档验证；候选一律 `verified: false`（冻结字段，无升级入口）。扫描基线：`dsh` 0.2.1-alpha.1（`origin/master`，commit `5badb15009`），扫描日期 2026-10-06。

## 1. 系统定位

DeepSeek Harness（`dsh`）是 DeepSeek AI 开源的 agent harness，采用「一切皆插件」架构，构建于 Cordis 框架之上（`README.md`）。模型适配器、工具注册表、会话日志、agent loop 本身都是可替换插件，没有特权内核（`docs/architecture.md` §Cordis）。

## 2. 总体架构：profile/bundle 分层组合

一个运行中的 `dsh` 是启动时按序组合出的插件树。**profile** 是 Harness home 中的具名组合，声明其堆叠的 bundle、树外插件与用户 `cordis.patch.yml`；**bundle** 是 Cordis 配置行及其挂载代码的分发格式。层叠顺序：profile 列出的 bundle（按序）→ profile patch → home patch → `--patch` overlay（`docs/architecture.md` §Profiles and bundles）。

内置 profile：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`；共享首层 `dsh-base`（模型适配器、工具、持久化、沙箱与审批策略、设置、凭证、遥测），`sdk-minimal` 是唯一不应用 `dsh-base` 的例外（`docs/architecture.md` §Profiles and bundles、§Application launch）。

## 3. 产品 API 脊柱（core/）

| 包 | 拥有 | ctx 键 |
|---|---|---|
| core/session | append-only `SessionEvent` 日志与内存存储 | `ctx.sessions` |
| core/system-prompt | 提示节与工具 schema 装配 | `ctx.systemPrompt` |
| core/tools | 作用域工具注册表与受护执行管线 | `ctx.tools` |
| core/agent | `Agent` 接口、活注册表与 `agent/*` 事件 | `ctx.agents` |
| core/agent-loop | 实现该接口的默认驱动 | `ctx.agentLoop` |
| core/scope | 按 agent 作用域注册原语 | 库，无键 |
| llm/llm | 消息/流词汇与适配器缝 | `ctx.llm` |
| webhook/webhook | 鉴权投递派发与 Workspace Session 创建 | `ctx.webhookRuntime` |

事实来源：`docs/architecture.md` §Core packages。

## 4. 能力缝（capability seam）全景

一个缝 = Service Definition + Service Provider + Consumer 三角色，缺一不可（`docs/architecture.md` §Capability seams）。当前在册的主要缝（`ctx.*` 服务键，证据见 packages/*/README.md 与 `docs/architecture.md`）：

- **执行域**：`ctx.fs`（文件系统）、`ctx.shell`（bash/pwsh）、`ctx.subprocess`（子进程）、`ctx.terminals`（持久 PTY）、`ctx.sandbox`（进程沙箱）、`ctx.ssh`（POSIX 远程）、`ctx.lsp`（语言服务器）、`ctx.ptcRuntime`（PTC 程序执行）。
- **模型域**：`ctx.llm`（LLM 适配）、`ctx.tokenMeter`（token 计量）、`ctx.web`（web 搜索/抓取）、`ctx.skills`（技能目录）、`ctx.compaction`（历史压缩）、`ctx.mcpResources`（MCP 资源）。
- **代理协作域**：`ctx.subagents`（子代理委派）、`ctx.workflowEngine`（工作流编排）、`ctx.jobs`（后台作业）、`ctx.agentTeams`（实验 Agent Teams）、`ctx.agentPresets`（预设组合）、`ctx.browserUse`/`ctx.computerUse`（浏览器/桌面操作）。
- **会话数据域**：`ctx.sessionPersistence`（持久化）、`ctx.sessionProjections`（投影）、`ctx.sessionQuery`（检索）、`ctx.sessionTitle`（标题）、`ctx.sessionTelemetry`（遥测）、`ctx.storage`（非会话存储）、`ctx.spillStore`（溢出）、`ctx.attachments`（附件）、`ctx.workspaceRegistry`（工作区）。
- **人机交互域**：`ctx.approval`（审批）、`ctx.userQuestions`（提问）、`ctx.permissionPresets`（权限预设）、`ctx.commands`（人类命令）、`ctx.goals`（目标）、`ctx.schedule`（定时提醒）、`ctx.planMode`（计划模式）。
- **宿主与配置域**：`ctx.settings`、`ctx.credentials`、`ctx.authorization`、`ctx.hmr`、`ctx.pluginManager`、`ctx.configEditor`、`ctx.officeToPdf`、`ctx.webhookRuntime`、`ctx.remote`（Typert RPC 网关）。

## 5. 事件域与 turn 流程

事件分三域：持久 **Session 事件**（`turn/*`、`step/*`、`system/message`、`user/message`、`assistant/*`、`tool/*`，追加进日志并广播）、活的 **Agent 事件**（`agent/*`，携带活 Agent）、**能力事件**（`fs/*`、`tools/*` 等，给缝挂策略与适配器）。一个 **step** = 一次模型请求 + 其工具调用；一个 **turn** = 零或多个 step。主链：`turn/start → agent/pre-step → step/start → agent/request → llm/stream → agent/assistant-stream → tool/call → tools/pre-execute → tools/execute → tools/post-execute → step/end → agent/turn-stopping → turn/end`。`agent/pre-step`、`agent/request`、`llm/stream`、`tools/*` 为瀑布事件，监听者必须 `next()` 委托。事实来源：`docs/architecture.md` §Events、§Turn flow。

## 6. 会话日志与投影

会话日志是模型所见上下文的唯一来源（`deriveMessages()` 投影模型历史；**模型可见 ⟺ 已落日志**）。格式代际：JSONL v0 用 `session.jsonl[.zstd]`，v1+ 用 `session.vN.jsonl[.zstd]`；已提交代际路径永不改名/替换/删除；`open` 选择数值最高的规范代际，拒绝未来版本，或经静态相邻迁移链解码一次；写打开先在旁发布最终版本命名的后继，源保持不变。投影缝 `ctx.sessionProjections`：注册单元增量折叠已提交事件，宿主读者经 `stateOf()` 读单一类型化状态。事实来源：`docs/architecture.md` §Session log、AGENTS.md「Pre-stable APIs and released Session data」。

## 7. 外围子系统

- **desktop-app**：Electron 桌面应用（`apps/desktop` 壳 + `apps/desktop-host` Node-mode 宿主），携带精确 dsh 生产运行时，拥有保留 profile `desktop`，经 Node IPC 注入 boot、就绪、致命错误与关机信号（`docs/architecture.md` §Desktop application）。
- **web-bff**：`api/` 组提供 Remote BFF 装配与 Typert RPC 网关（`ctx.remote`），Client 以类型化方法调用 Host 能力；`typert/` 组负责类型图生成、产物加载与运行时注册（`packages/README.md`）。
- **client-web**：`client/` 组（63 包）提供 Web GUI 浏览器半（会话、导航、设置、审批、文件访问等），`apps/web` 为 vite 构建入口，dist 由 `dsh web` 伺服（`packages/README.md`、agent 扫描）。
- **sdk-typescript**：`sdk/` 组，newline-delimited JSON-RPC stdio 协议 + TypeScript client/server（`packages/sdk/README.md`）。
- **sdk-python**：`python/sdk`（PyPI `deepseek-harness-sdk`）+ `python/sdk-runtime`（按平台打包 dsh CLI 的 runtime wheel，控制台脚本 `dsh`）（`python/sdk/README.md`、`python/sdk-runtime/pyproject.toml`）。
- **native-addons**：`native/` 的 `@deepseek-ai/node-addon-system`，导出 `./landlock-run`（Landlock 沙箱启动器）与 `./flock`（异步 POSIX flock），按平台 optionalDependencies 分发预编译包（`native/system/packages/entry/package.json`）。

## 8. 包全景统计

`packages/` 共 56 个 group、约 331 个 workspace 包（agent 扫描统计，0.2.1-alpha.1）；另含 `apps/` 4 应用、`python/` 2 包、`native/` 6 包。约 335 个包公开发布，20 个 private。group 全景与逐包职责见 `packages/README.md` 与各 group README；依赖图见生成物 `docs/module-graph.md`。

## 9. fleet 部署形态（user-fleet-gateway 引入）

单用户进程模型不变；fleet 在部署层新增两个进程侧组件，把「一机一进程」扩展为「一机多用户进程，进程间隔离」：

| 组件 | 职责 | 与既有组件的关系 |
|---|---|---|
| `dsh-gateway` | OIDC 认证反向代理：按网关会话身份把请求路由到对应用户 dsh Host 进程的 loopback 端口；跨用户访问在网关拒绝 | 叠加在既有 `--public-url`/`--trusted-host` 反向代理路径（S05）之上；现有启动令牌机制原样保留在网关内层，不出本机回环 |
| `dsh-fleet-manager` | 用户进程注册表：首次登录 spawn `dsh --profile web`（OS 分配端口）并注入该用户专属 `$DSH_HOME`；空闲回收、崩溃重启、并发上限 | 复用 `home-paths` 显式 home 能力与 python sdk-runtime「显式 home + 子进程管理」先例（S06） |

**隔离不变式**（本变更立下、后续变更须遵守的约束）：

1. **一用户一进程一 home**：用户间隔离边界 = OS 进程 + 文件系统目录；不把用户维度引入任何存储格式（共享存储属 M2 之后的里程碑）。
2. **启动令牌不出回环**：`?token=` 进程凭证仅在网关与本机用户进程之间传递；用户浏览器只持网关会话。
3. **授权在网关强制**：跨用户可达性由网关按会话归属判定；M1 威胁模型假设本机管理层（网关与 fleet 管理器的运行者）可信，用户进程仅经 loopback 接受网关转发。
4. **现有包语义零破坏**：web-app 启动仅新增「信任 loopback 网关转发头」配置项；anonymous-user-id 新增可选的 fleet 注入身份读取（审计归属，G1-4）。

**资源控制**：fleet 并发上限与空闲回收阈值是部署配置项（非硬编码常量），是控制多用户部署 CPU/内存占用的主旋钮；验收与冒烟执行以小上限、串行冒烟为默认策略。

## 逆向基线来源
```yaml
candidates:
  - key: core::021e07d3146f
    anchor: service:ctx.jobs
    display: 后台作业注册表（jobs/jobs）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::02643a928c63
    anchor: service:ctx.commands
    display: 人类命令注册表（interaction/commands）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::05107c50958d
    anchor: subsystem:desktop-app
    display: Electron 桌面应用（apps/desktop + apps/desktop-host）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::06175fd8fb38
    anchor: service:ctx.approval
    display: 用户审批缝（interaction/user-approval）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::0660badfb2cd
    anchor: service:ctx.workflowEngine
    display: 工作流引擎缝（workflow/workflow）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::10406063a879
    anchor: service:ctx.officeToPdf
    display: Office 转 PDF（document/office-to-pdf）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::11d0adb61155
    anchor: subsystem:session-log-format
    display: 会话日志格式代际与相邻迁移链
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::13f360198e86
    anchor: service:ctx.storage
    display: 非会话存储枢纽（storage/storage）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::15fea00ad242
    anchor: subsystem:sdk-python
    display: Python SDK 与运行时 wheel（python/）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::1cc10e6e81bf
    anchor: service:ctx.agentTeams
    display: 实验 Agent Teams（experimental/agent-team）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::2658738f165b
    anchor: service:ctx.credentials
    display: 凭证引用缝（credentials/credentials）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::269a15963e32
    anchor: service:ctx.userQuestions
    display: 用户提问缝（interaction/user-questions）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::2902d351a654
    anchor: service:ctx.skills
    display: 技能提供商注册表（skill/skill）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::2cada473f047
    anchor: subsystem:client-web
    display: Web GUI 浏览器半（client/ + apps/web）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::2fd6b579889b
    anchor: service:ctx.sessionQuery
    display: 会话检索服务（session-query/session-query）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::351a7a4183d1
    anchor: subsystem:web-bff
    display: Web Remote BFF 与 Typert 类型图（api/ + typert/）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::354c626213c6
    anchor: service:ctx.tokenMeter
    display: token 计量（llm/token-meter）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::3fba2183f91d
    anchor: service:ctx.hmr
    display: 配置热重载（boot/hmr）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::42be1a57a8f2
    anchor: service:ctx.computerUse
    display: 桌面操作提供商（computer-use）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::442894cb8630
    anchor: service:ctx.spillStore
    display: 溢出存储缝（spill/spill）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::463b854b8a9c
    anchor: service:ctx.subagents
    display: 子代理委派缝（subagent/subagent）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::4748a8322328
    anchor: service:ctx.fs
    display: 文件系统能力缝（fs/fs）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::4a95bb7df60d
    anchor: service:ctx.sandbox
    display: 进程沙箱缝（sandbox/sandbox）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::4e48c0905c6e
    anchor: service:ctx.compaction
    display: 会话压缩缝（compaction/compaction）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::512851fd6a19
    anchor: service:ctx.authorization
    display: 人机授权流程缝（credentials/authorization）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::532d6c66d011
    anchor: service:ctx.terminals
    display: 持久 PTY 会话缝（terminal/terminal）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::53d5da875440
    anchor: service:ctx.sessionTitle
    display: 会话标题服务（session/session-title）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::54af594f9b64
    anchor: service:ctx.llm
    display: 提供商中立 LLM 服务缝（llm/llm）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::5afcac64bfa4
    anchor: service:ctx.mcpResources
    display: MCP 资源读取（mcp/mcp-resources）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::5b77621524b4
    anchor: service:ctx.systemPrompt
    display: 系统提示装配（core/system-prompt）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::5e804c912622
    anchor: service:ctx.remote
    display: Typert RPC 网关（api/api-gateway）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::608176717597
    anchor: service:ctx.agents
    display: Agent 接口与注册表（core/agent）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::60c31c4bbab9
    anchor: service:ctx.settings
    display: 用户设置缝（settings/settings）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::61196dbd321e
    anchor: service:ctx.webhookRuntime
    display: webhook 规则运行时（webhook/webhook）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::61edb9433267
    anchor: layer:profile-bundle-composition
    display: profile/bundle 分层组合机制
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::6359a16f68af
    anchor: service:ctx.schedule
    display: Host 级定时提醒（schedule/schedule）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::69d830e7f5fe
    anchor: service:ctx.ptcRuntime
    display: PTC 程序执行缝（ptc-runtime/ptc-runtime）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::7597d2926b85
    anchor: service:ctx.planMode
    display: 计划模式状态（plan/plan-mode）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::7cfc6f06dc56
    anchor: service:ctx.pluginManager
    display: 插件/bundle 管理（boot/plugin-manager）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::80b5259de838
    anchor: service:ctx.agentPresets
    display: Agent 预设注册表（preset/agent-preset-registry）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::9eb3a2f0ab80
    anchor: subsystem:native-addons
    display: node-addon-system 原生原语（native/）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::a19f88cc5f7b
    anchor: service:ctx.attachments
    display: 附件存储缝（attachment/attachment）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::a20453217bc9
    anchor: service:ctx.ssh
    display: POSIX SSH 远程助手（ssh/ssh）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::b334b3677bb1
    anchor: pkg:vendor-cordis
    display: 内购 Cordis 框架（vendor/cordis）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::bdeb72a0ca67
    anchor: service:ctx.configEditor
    display: 配置编辑（boot/config-editor）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::c432a0e4e925
    anchor: service:ctx.workspaceRegistry
    display: 工作区实体注册表（workspace/workspace）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::c9e42a987b53
    anchor: service:ctx.lsp
    display: 语言服务器能力缝（lsp/lsp）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::cbaeb7f3b785
    anchor: service:ctx.web
    display: Web 搜索/抓取能力缝（web/web）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::cd93ad775330
    anchor: service:ctx.sessionProjections
    display: 会话投影缝（session/session-projection）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::cdb499ae1897
    anchor: pkg:@deepseek-ai/dsh-scope
    display: 按 agent 作用域注册原语（core/scope）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::d12ac9fe2953
    anchor: service:ctx.tools
    display: 工具注册表与执行管线（core/tools）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::d17ef4c3c644
    anchor: service:ctx.permissionPresets
    display: 权限预设（interaction/permission-presets）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::d81d9f4cc412
    anchor: subsystem:sdk-typescript
    display: TypeScript SDK（sdk/）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::e4e7f8f9380b
    anchor: service:ctx.sessionPersistence
    display: 会话持久化缝（session/session-persistence）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::ec965cf194fc
    anchor: service:ctx.browserUse
    display: 浏览器操作提供商（browser-use）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::f2f37ca478a2
    anchor: service:ctx.shell
    display: bash/pwsh 执行缝（shell/shell）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::f92cc601418d
    anchor: service:ctx.subprocess
    display: 子进程管理缝（subprocess/subprocess）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::faa81ac7b8e4
    anchor: service:ctx.sessions
    display: 会话事件溯源存储（core/session）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::fad64b6f54c9
    anchor: subsystem:turn-flow
    display: turn/step 事件流与瀑布扩展点
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::fbc32314bd61
    anchor: service:ctx.goals
    display: 同会话目标状态（goal/goal）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::fd596ef6e324
    anchor: service:ctx.sessionTelemetry
    display: 会话遥测后端缝（session/session-telemetry）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::ffd616f8b753
    anchor: service:ctx.agentLoop
    display: 具体 agent loop 驱动（core/agent-loop）
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

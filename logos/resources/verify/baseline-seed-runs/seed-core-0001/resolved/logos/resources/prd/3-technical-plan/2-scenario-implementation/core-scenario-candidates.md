# core 场景候选清单（scenario-candidates）

> **逆向基线声明**：本文档是 brownfield-adopter（S33）逆向扫描产出的**现状快照**，不是权威意图文档。以下场景全部从代码与随仓文档逆向提取，`verified: false` 恒冻结；它们是**场景候选**——未登记进 `scenarios[]`、不分配 `Sxx` 编号、不改动 `scenario_counter`，后续经 `feature-backfill` 等前向流程去重登记（已登记去重硬门：同 module 同 name 逐字相等即剔除）。扫描基线：`dsh` 0.2.1-alpha.1（`origin/master`，commit `5badb15009`），扫描日期 2026-10-06。

## 候选总表

| # | 场景 | 触发者 | 主路径（压缩） | 成果 | 事实来源 |
|---|---|---|---|---|---|
| 1 | 启动 Web UI 并运行首个仓库任务 | 终端用户 | `dsh web` 启动并打印带令牌 URL → 浏览器选工作区 → 设置页保存 API key → Composer 发任务 → 代理读文件/跑命令并产出 | 浏览器中获得可交互代理会话 | `docs/user/guide/index.md`、`README.md` |
| 2 | 一次性无头任务并打印最终答案 | 终端用户 / CI | `dsh headless "task"` → 启动 headless profile → 创建持久化会话执行 → 打印最终答案并退出 | 命令行直接获得任务结果 | `apps/cli/README.md`、`packages/bundle/headless/` |
| 3 | ACP 编辑器/自动化后端会话 | ACP 客户端 | `dsh acp` 启动 → stdio `initialize` 握手 → 创建/恢复会话、发 prompt → 接收语义更新与权限提示 → 关闭连接 | 编辑器/自动化以 ACP 协议驱动代理 | `packages/acp/README.md`、`apps/cli/README.md` |
| 4 | 为 profile 安装/移除插件 | 终端用户 | `dsh plugin --profile <name> add <pkg>` → 转发 profile 目录 pnpm → 记录 `dsh.bundle` 层 → 重启生效 | 用户扩展 profile 插件能力 | `apps/cli/src/args.ts:187-199`、`apps/cli/README.md` |
| 5 | 反向代理公开部署 Web UI | 运维 | `--public-url` + `--trusted-host` 启动 → 代理剥前缀/转发 WebSocket/重写 cookie → 外部浏览器经令牌换 cookie 访问 | 外部受信用户经 HTTPS 使用 Web UI | `docs/user/guide/public-deployments.md` |
| 6 | Python 程序嵌入 DSH 完成任务 | Python 开发者 | 安装 `deepseek-harness-sdk` → 构造 `DeepSeekHarness` → `harness.run(task)` 懒启动 `dsh --profile sdk-minimal` → 读 `result.final_response` | Python 程序直接调用 DSH | `docs/user/guide/python-sdk.md`、`python/sdk/README.md` |
| 7 | TypeScript 程序驱动 DSH 运行时 | TS 开发者 | 启动 `dsh --profile sdk` → stdio JSON-RPC `initialize` → 创建会话/发 prompt → 接收事件与通知 → shutdown | 外部程序编程化使用完整运行时 | `packages/sdk/README.md`、`packages/sdk/server/README.md` |
| 8 | Desktop 首次启动与后台保持运行 | 终端用户 | 安装 Desktop → Welcome/无 key 则 API-key 页 → Host boot 注入后进入工作区 → 关窗时询问后台运行 → 托盘/Dock 恢复 | 原生外壳桌面应用可持续跑长任务 | `apps/desktop/README.md` |
| 9 | 复用 Claude Code hooks.json 钩子策略 | 存量 Claude Code 用户 | 挂载 `dsh-hooks-claude-code` 并指 `configPath` → 启动读配置 → 在 `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop` 等时机串行执行钩子 | 钩子策略零重写迁移到 DSH | `packages/hooks/hooks-claude-code/README.md` |
| 10 | 复用 Codex hooks.json 钩子策略 | 存量 Codex 用户 | 挂载 `dsh-hooks-codex` 并指 `configPath` → 同步 command 钩子在受支持事件点执行 → 失败仅记录 | Codex 门控策略迁移到 DSH | `packages/hooks/hooks-codex/README.md` |
| 11 | 计划模式：先规划、审批后执行 | 终端用户 | `/plan` 进入 → 注入 `plan:policy` → 代理探索设计不执行 → `exit_plan_mode` 提交计划 → 用户审批后执行 | 复杂任务先确认计划再动手 | `packages/plan/plan-mode/README.md`、`docs/subsystems/plan.md` |
| 12 | 会话任务清单维护 | 模型（用户自然语言触发） | 模型调 `todo_write` 替换整个任务表 → 状态随会话持久化 → 重开会话续看进度 | 会话内结构化任务跟踪 | `packages/todo/tool-todo/README.md` |
| 13 | 子代理委派（spawn/fork/可延续） | 父代理 | `subagent` 工具指定 provider 与 prompt → `ctx.subagents` 校验并建 child Session → 子代理运行 → 结果回父代理；可延续子代理经 `send_message` 续聊 | 子任务隔离/继承上下文/长周期交互 | `docs/subsystems/subagent.md`、`packages/subagent/` |
| 14 | workflow 脚本并行编排子代理 | 父代理 | 模型调 `workflow` 提交编排脚本 → PTC Node 运行时执行 → fan-out 多个子代理 → 收集结果返回 | 模型可写多代理并行脚本 | `packages/workflow/README.md`、`packages/workflow/tool-workflow/` |
| 15 | 长会话压缩（自动/手动） | 系统 / 用户 | token 压力触发 basic 压缩或 `/compact` 手动 → 先修剪超大 tool output → 旧历史变摘要 → 图片超预算换占位 | 长会话贴近上下文上限仍可续跑 | `packages/compaction/README.md` |
| 16 | 跨重启定时提醒 | 终端用户 / 模型 | `schedule_create` 建规则（一次性/间隔/每日/每周/cron） → Host 持久化、重启恢复 → 到期写回原会话 inbox → Automation tasks 页管理 | 跨会话持久提醒系统 | `docs/user/guide/schedule.md`、`packages/schedule/` |
| 17 | GitHub PR ready_for_review 触发审查会话 | GitHub webhook | 配 `DSH_GITHUB_WEBHOOK_SECRET` + overlay 启动 → PR 转 ready 时签名事件到 `/github` → 校验签名 → 建只读审查会话输出审查结果 | PR 状态变化自动触发审查 | `docs/user/guide/github-review.md`、`packages/webhook/` |
| 18 | 接入外部 MCP 工具与资源 | 终端用户 | overlay 配 `mcp-client`（stdio/streamable-http） → 发现工具暴露为 `mcp__<server>__<tool>` → 模型调用经 client 转发 → 崩溃自动重连重同步 | 模型可调用任意 MCP 服务 | `packages/mcp/README.md`、`docs/user/guide/mcp-memory.md` |
| 19 | 发现并加载项目/用户技能 | 终端用户 / 模型 | `skill-filesystem` 发现技能文件 → registry 合并目录 → `/skillname` 直调或 `skill` 工具加载完整指令 | 可复用 prompt/流程沉淀 | `packages/skill/README.md` |
| 20 | Web 设置中配置模型提供商 | 终端用户 | Settings→Models 保存 key（写入 `$DSH_HOME/.credentials.yaml`） → 添加内置第三方或自定义 OpenAI 兼容网关 → 可取模型列表 → Composer 选模型 | 多提供商配置持久化 | `docs/user/guide/providers.md` |
| 21 | 敏感工具调用的人工审批 | 工具执行管线 | 敏感操作触发 `ctx.approval.request()` → `ask` 策略派发 answerer 瀑布 → Web UI 弹审批 → 允许/拒绝记录审计事件 → 按结果执行 | 敏感操作一次性人工控制 | `packages/interaction/user-approval/README.md`、`docs/subsystems/approval.md` |
| 22 | 沙箱内执行命令并申请权限升级 | 模型 | `bash` 越界访问被沙箱拦 → 返回 denial 事实 → 同 turn 以更宽 `sandbox_permissions` + 理由重试 → 用户批准后执行 | 默认最小权限、升级需授权 | `packages/shell/tool-bash/README.md` |
| 23 | 模型向用户提问获取确认 | 模型 | 模型调 `ask_user_question` → `ctx.userQuestions` 开问题 → Web UI 问题卡 → 答案作为 `user-question-reply` 进会话 | 执行中获取确认/缺失信息 | `packages/interaction/tool-ask-user/README.md` |
| 24 | 会话长期目标的设置与跟踪 | 终端用户 / 模型 | `/goal` 命令或 `create_goal` 建目标 → `goal/change` 事件持久化 → `get_goal`/`update_goal` 跟踪 → 可选 round-driver 自动推进 | 跨重启的持久会话目标 | `packages/goal/README.md` |
| 25 | 会话级与消息级反馈 | 终端用户 | `/feedback` 弹会话反馈对话框 → 记录 `sessionFeedback`（不入模型上下文） → 单条消息 rating/category/note 持久化 | 满意度信号不污染上下文 | `packages/feedback/README.md` |
| 26 | 会话持久化、重启恢复与导出 | 终端用户 | append-only 日志写 JSONL 后端（可 zstd） → checkpoint 策略在关键节点 flush → 重启恢复、中断尾补 `interrupted` → `/export` 导出 ZIP | 会话跨进程保留并可离线分享 | `packages/session/README.md`、`packages/session-query/session-log-export/` |
| 27 | 从历史分叉会话 | 终端用户 / 工具 | `ctx.sessions.fork()` 复制到边界的事件前缀 → open turn 边界补合成 closer（`forked`） → 新 child Session 带 `parentSession` 标记独立演化 | 从历史稳定点派生探索分支 | `docs/subsystems/session.md` |
| 28 | 历史会话全文搜索 | 终端用户 / 模型 | `session-query-sqlite` 维护 FTS5 索引 → UI 或 `session_search` 工具发起 → 返回匹配会话与消息 | 大量历史会话中快速定位 | `packages/session-query/README.md` |
| 29 | 模型声明最终交付文件 | 模型 | 任务完成后调 `present` 声明最终文件 → 记录 durable Session 事件 → Web UI 渲染交付卡片；`workspace-changes` 另出 changed-files 卡片与 diff | 用户直观看到交付与改动 | `packages/deliverables/README.md` |
| 30 | 提示中附加持久化图片 | 终端用户 | Composer 附加图片 → `attachment-local` 存入 `$DSH_HOME` → 随 user message 发模型 → 历史中复现 | 跨 turn/会话保持图片上下文 | `packages/attachment/README.md` |

## 逆向基线来源
```yaml
candidates:
  - key: core::01df7b3bfa84
    anchor: scenario:web-first-session
    display: 启动 Web UI 并运行首个仓库任务（入口 cli:dsh web）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::0381b8854d00
    anchor: scenario:session-persistence
    display: 会话持久化、重启恢复与导出（session 数据面）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::1944e6edf513
    anchor: scenario:session-fork
    display: 从历史分叉会话（ctx.sessions.fork）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::1d61ed314b20
    anchor: scenario:sandbox-escalation
    display: 沙箱内执行命令并申请权限升级（工具 bash 沙箱升级）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::34934951ae34
    anchor: scenario:workflow-orchestration
    display: workflow 脚本并行编排子代理（工具 workflow）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::3cde3a4cc491
    anchor: scenario:ask-user-question
    display: 模型向用户提问获取确认（工具 ask_user_question）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::3f34505c7953
    anchor: scenario:codex-hooks
    display: 复用 Codex hooks.json 钩子策略（桥 dsh-hooks-codex）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::41cab54489d5
    anchor: scenario:web-approval
    display: 敏感工具调用的人工审批（审批面 web-approval）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::435ff52076c2
    anchor: scenario:subagent-delegation
    display: 子代理委派：spawn/fork/可延续（工具 subagent）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::49ecfe1e56ca
    anchor: scenario:compact
    display: 长会话压缩：自动与 /compact（命令 /compact）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::4ebe9bea1726
    anchor: scenario:todo-list
    display: 会话任务清单维护（工具 todo_write）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::55ed779a325a
    anchor: scenario:web-model-settings
    display: Web 设置中配置模型提供商（设置面 web-settings-models）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::646fd86ea841
    anchor: scenario:mcp-tools
    display: 接入外部 MCP 工具与资源（桥 mcp-client）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::6650b5593bfe
    anchor: scenario:web-public-deploy
    display: 反向代理公开部署 Web UI（入口 cli:dsh web --public-url）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::782dfc0089fe
    anchor: scenario:typescript-sdk-drive
    display: TypeScript 程序驱动 DSH 运行时（入口 @deepseek-ai/dsh-sdk-client）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::7dbd422f42ed
    anchor: scenario:desktop-first-run
    display: Desktop 首次启动与后台保持运行（入口 apps/desktop）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::884f2b024093
    anchor: scenario:feedback
    display: 会话级与消息级反馈（命令 /feedback）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::9ae3a53ad905
    anchor: scenario:present-deliverables
    display: 模型声明最终交付文件（工具 present）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::afcea59da698
    anchor: scenario:skill-loading
    display: 发现并加载项目/用户技能（工具 skill）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::c1ec9e3724fe
    anchor: scenario:acp-backend
    display: ACP 编辑器/自动化后端会话（入口 cli:dsh acp）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::c34315b70a01
    anchor: scenario:image-attachment
    display: 提示中附加持久化图片（attachment 服务）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::c7602fd8c66d
    anchor: scenario:schedule-reminder
    display: 跨重启定时提醒（工具 schedule_create）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::c81777abbc44
    anchor: scenario:python-sdk-embed
    display: Python 程序嵌入 DSH 完成任务（入口 deepseek_harness.DeepSeekHarness）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::cb0e994272e2
    anchor: scenario:plan-mode
    display: 计划模式：先规划、审批后执行（工具 exit_plan_mode）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::de01a490997b
    anchor: scenario:headless-one-shot
    display: 一次性无头任务并打印最终答案（入口 cli:dsh headless）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::e14aefd153c9
    anchor: scenario:goal-tracking
    display: 会话长期目标的设置与跟踪（命令 /goal）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::e22567c16781
    anchor: scenario:github-pr-review
    display: GitHub PR ready_for_review 触发审查会话（路由 /github）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::e48eb5b92f03
    anchor: scenario:plugin-management
    display: 为 profile 安装/移除插件（入口 cli:dsh plugin）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::fc02dc5d6745
    anchor: scenario:session-search
    display: 历史会话全文搜索（工具 session_search）
    state: active
    verified: false
    aliases: []
    superseded_by: []
    confirmed_by: null
    evidence: null
    confirmed_at: null
    retired_by: null
    retire_event_id: null
  - key: core::fe5cbf156547
    anchor: scenario:claude-code-hooks
    display: 复用 Claude Code hooks.json 钩子策略（桥 dsh-hooks-claude-code）
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

# delta — core-01-requirements.md（变更 20261030-1651-cluster-web-independent-launch）

## MODIFIED — 三、场景总览

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S01 | 启动 Web UI 并运行首个仓库任务 | 用户运行 `dsh web` | P01/P02/P08 | P0 |
| S02 | 一次性无头任务并打印最终答案 | 用户/CI 运行 `dsh headless` | P01/P03 | P0 |
| S03 | ACP 编辑器/自动化后端会话 | ACP 客户端连接 `dsh acp` | P07 | P1 |
| S04 | 为 profile 安装/移除插件 | 用户运行 `dsh plugin` | P02 | P1 |
| S05 | 反向代理公开部署 Web UI | 运维以 `--public-url` 启动 | P01 | P1 |
| S06 | Python 程序嵌入 DSH 完成任务 | Python 代码构造 `DeepSeekHarness` | P07 | P0 |
| S07 | TypeScript 程序驱动 DSH 运行时 | TS 代码经 `dsh-sdk-client` 连接 | P07 | P0 |
| S08 | Desktop 首次启动与后台保持运行 | 用户安装并启动桌面应用 | P03 | P1 |
| S09 | 复用 Claude Code hooks.json 钩子策略 | 挂载 `dsh-hooks-claude-code` | P02 | P2 |
| S10 | 复用 Codex hooks.json 钩子策略 | 挂载 `dsh-hooks-codex` | P02 | P2 |
| S11 | 计划模式：先规划、审批后执行 | 用户输入 `/plan` | P01/P08 | P0 |
| S12 | 会话任务清单维护 | 模型调用 `todo_write` | P05 | P1 |
| S13 | 子代理委派（spawn/fork/可延续） | 模型调用 `subagent` | P05 | P0 |
| S14 | workflow 脚本并行编排子代理 | 模型调用 `workflow` | P05 | P0 |
| S15 | 长会话压缩（自动/手动） | token 压力或 `/compact` | P03/P05 | P1 |
| S16 | 跨重启定时提醒 | 模型/用户调用 `schedule_create` | P06 | P1 |
| S17 | GitHub PR ready_for_review 触发审查会话 | 签名 webhook 到 `/github` | P06 | P0 |
| S18 | 接入外部 MCP 工具与资源 | overlay 配置 `mcp-client` | P04 | P1 |
| S19 | 发现并加载项目/用户技能 | 模型/用户调用 `skill` | P02 | P2 |
| S20 | Web 设置中配置模型提供商 | 用户打开 Settings→Models | P04 | P1 |
| S21 | 敏感工具调用的人工审批 | 敏感操作触发审批流 | P01/P08 | P0 |
| S22 | 沙箱内执行命令并申请权限升级 | 模型在 bash 中申请放宽沙箱 | P01 | P0 |
| S23 | 模型向用户提问获取确认 | 模型调用 `ask_user_question` | P08 | P1 |
| S24 | 会话长期目标的设置与跟踪 | `/goal` 或 `create_goal` | P05 | P2 |
| S25 | 会话级与消息级反馈 | 用户输入 `/feedback` | P08 | P2 |
| S26 | 会话持久化、重启恢复与导出 | 会话全程/重启/`/export` | P03 | P1 |
| S27 | 从历史分叉会话 | 用户/工具发起 fork | P03/P08 | P2 |
| S28 | 历史会话全文搜索 | 用户/模型调用 `session_search` | P03 | P1 |
| S29 | 模型声明最终交付文件 | 模型调用 `present` | P08 | P2 |
| S30 | 提示中附加持久化图片 | 用户附加图片 | P03 | P2 |
| S31 | 用户经认证网关登录并进入自己的 Harness | 用户浏览器访问 fleet 网关 | P09 | P0 |
| S32 | 跨用户数据不可达 | 用户尝试触达另一用户的数据 | P09/P01/P08 | P0 |
| S33 | fleet 用户进程生命周期 | 首次登录/空闲/崩溃/达并发上限 | P09/P03 | P1 |
| S34 | 共享会话世代的跨节点读写与崩溃恢复 | 部署指向共享 Postgres 持久层，双节点开同一会话 | P03/P09 | P0 |
| S35 | 共享域数据的每用户命名空间 | 多用户共享同一 Postgres KV 层 | P09/P01/P08 | P0 |
| S36 | 附件与溢出的共享存取 | 会话附件写入共享层并被任一节点取回 | P03/P09 | P1 |
| S37 | 会话租约的跨节点单写者 | 执行池内两个 runner 同时被指派同一会话，或持有者崩溃 | P03/P09 | P0 |
| S38 | 队列派发与 inbox 投影接续 | 用户消息/webhook 入队，空闲 runner 取走并接续 | P03/P06 | P0 |
| S39 | 流中继的跨副本实时 | runner 执行中，浏览器连到非属主 Web/API 副本 | P08 | P1 |
| S40 | 共享 schedule 到期恰一交付 | 部署双 runner 共享库，任务到期 | P03/P06 | P0 |
| S41 | webhook 入口无状态化恰一建会话 | 外部事件到达入口副本 | P06/P09 | P0 |
| S42 | runner 排空与滚动升级 | 升级发布，runner 收到排空指令 | P03 | P1 |
| S43 | 同域 cluster-web Compose 一键启动 | 运维执行 compose up / supervise | P03/P08 | P0 |
| S44 | 同域 cluster-web 一键启动（进程树） | 运维执行 `pnpm run cluster-web:up` | P03/P08 | P0 |
| S45 | 同域 cluster-web Helm/K8s 一键投影 | 运维执行 `helm upgrade --install` | P03/P08 | P1 |
| S46 | 同域前后端分离（API-only + shell） | 运维启用 cluster-web 三分流 / 外仓替换 shell | P03/P08 | P0 |
| S47 | 同域前后端双容器 + API 容器级副本 | 运维 compose up frontend/api（可 scale api） | P03/P08 | P0 |

## MODIFIED — S46: 同域前后端分离（API-only + shell）

- **触发条件**：运维使用 `deploy/cluster-web`（compose / supervise / `pnpm run cluster-web:up` / Helm）且启用前后端分流；或外仓前端按同域契约替换 shell
- **用户价值**：浏览器仍只开一个 origin；前端托管与后端 API 副本解耦，便于前端独立成仓部署（← P03/P08；编排器无关「前端独立部署」原则落地）
- **优先级**：P0
- **主路径**：supervise 拉起 shell（`--profile web`，`serveFrontend: true`）+ N×API 副本（`--profile cluster-web-api`，bundle 置 `serveFrontend: false` 并切换 Postgres 持久化/流中继）→ edge 将 `/`（及静态、`/plugins`）指向 shell、`/api` 轮询 API → 用户打开 `PUBLIC_URL?token=` → shell 换 cookie → 浏览器相对路径调用 `/api` → SIGTERM 排空子树。

#### 验收条件
##### 正常：同域分流可达
- **GIVEN** shell=1、API_REPLICAS=1、RUNNER_REPLICAS=0（smoke 默认）
- **WHEN** 经 edge 的 `PUBLIC_URL?token=` 完成换票后请求 `/` 与 `/api`
- **THEN** `/` 返回注入 boot 的 HTML；带 cookie 的 `/api` 非 401；浏览器 Host 经 edge 原样转发
##### 正常：API-only 不提供 SPA
- **GIVEN** API 副本以 `cluster-web-api` profile 启动（bundle 置 `serveFrontend: false`）
- **WHEN** 直接请求该副本的 `/`（绕过 edge 的静态上游）
- **THEN** 无 frontend-static fallback（404 或等价非 SPA）；`/api` 仍可服务
##### 正常：无 Postgres 时显式回落
- **GIVEN** 未设置 `DATABASE_URL`（或 `CLUSTER_WEB_SKIP_OVERLAYS=1`）
- **WHEN** API 副本启动
- **THEN** 附加调用时补丁 `overlays/no-postgres.patch.yml`：禁用两个 Postgres 行、回落 `session-persistence-jsonl`；设置 `DATABASE_URL` 而缺失时启动即失败（fail-loud）
##### 正常：无跨域
- **GIVEN** 产品信任栅栏与 `SameSite=Strict` host-only cookie
- **WHEN** 试图将前端与 API 部署在不同浏览器 origin
- **THEN** 不在本场景支持范围；须同域反代统一 origin
##### 正常：副本上限与 CPU
- **GIVEN** 验收配置
- **WHEN** API_REPLICAS>2 或 RUNNER_REPLICAS>2
- **THEN** supervise 拒绝启动；冒烟串行且主机 CPU 峰值 ≤ 部署配置阈值
##### 正常：SIGTERM 排空
- **GIVEN** shell + API + edge 进程树就绪
- **WHEN** 向 supervise 发 SIGTERM
- **THEN** 子进程退出；supervise 在宽限内结束

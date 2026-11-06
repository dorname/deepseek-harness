# delta — core-01-requirements.md（变更 dsh-acp-permission-policy）

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
| S35 | 共享域数据的每用户命名空间 | 多用户共享同一 Postgres KV 层 | P09/P01 | P0 |
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
| S48 | 按供应商 baseURL 动态发现 DeepSeek 模型目录 | 读取目录、新建 ACP 会话或切换模型 | P04/P07 | P0 |
| S49 | 外部客户端配置会话审批策略与预设 | 外部 ACP 客户端设置会话审批策略或应用权限预设 | P01/P08 | P0 |

## ADDED — 四、核心场景详述 · S49

### S49: 外部客户端配置会话审批策略与预设

- **触发条件**：外部 ACP 客户端（如 dspm）对会话设置审批策略 `permission_policy` 或应用权限预设 `permission_preset`，以及策略生效后的工具调用审批交互。
- **用户价值**：外部客户端可以令 agent 按会话发起审批，审批回调从「通道存在但默认不可达」变为端到端可用；人对外部自动化中的代理行为恢复控制与可见性（← P01/P08）。
- **优先级**：P0
- **主路径**：客户端 `session/set_config_option { permission_policy }` → bridge 校验词表 `ask`/`never`/`always` → 既有 `ApprovalService.setPolicy` 落策略会话事件（ask/never 落 `approval/policy`，always 落新增 `approval/policy-always`）并注入模型可见切换通知 → configOptions 回显当前值 → 后续工具调用按档分发：`always` 对每次工具调用产生询问并路由进既有 serviceAsk 管线；`never` 自动拒绝询问；`ask`（默认）放行既有触发源产生的询问 → 询问经既有 `session/request_permission` 回环送达客户端 → allow-once / reject-once 一次性应答结算。
- **边界**：`permission_preset` 应用 permission-presets 既有 `{sandbox, approval}` 打包预设（read-only / workspace-write / danger-full-access，目录动态枚举，各档 approval 值沿用现行定义）；类别级询问（ask-writes / ask-network）不在范围；不提供 `allow_always` 持久授权选项；`/permission` 命令与 profile 会话种子行为不因本场景改变。

#### 验收条件
##### 正常：always 档全量询问
- **GIVEN** 会话策略设置为 `always`
- **WHEN** agent 发起文件写等工具调用
- **THEN** 每次调用先经 `session/request_permission` 询问客户端；allow-once 应答后工具执行，reject-once 应答后该调用被拒且会话与回合继续
##### 正常：never 档自动拒绝询问
- **GIVEN** 会话策略设置为 `never`
- **WHEN** 既有触发源（如 sandbox 升权、PreToolUse hook ask）产生询问
- **THEN** 询问被自动拒绝，不发起 `session/request_permission`，会话不中断
##### 正常：ask 档维持放行语义
- **GIVEN** 会话策略为 `ask`（默认）
- **WHEN** 无触发源的普通调用与 sandbox 升权混合执行
- **THEN** 普通调用不询问照常执行；升权询问正常送达客户端应答
##### 正常：预设应用与目录枚举
- **GIVEN** 客户端读取会话 configOptions
- **WHEN** 应用 `permission_preset=read-only` 并再次读取
- **THEN** 预设按 permission-presets 现行定义生效（sandbox 与 approval 打包变更落会话日志），configOptions 回显当前预设与策略值
##### 正常：resume 恢复策略状态
- **GIVEN** 会话已设置策略或预设并 `session/close`
- **WHEN** 新连接 `session/resume` 同一会话
- **THEN** 策略与预设状态经会话日志折叠恢复，configOptions 广告恢复后的当前值
##### 异常：未知值 fail-loud
- **GIVEN** 客户端设置 `permission_policy=paranoid` 或未知预设名
- **WHEN** `session/set_config_option`
- **THEN** 返回 JSON-RPC invalid params 类错误，策略与预设状态保持不变，不静默忽略
##### 回归：既有审批与会话行为
- **GIVEN** S03、S21、S22 既有会话与审批路径
- **WHEN** 执行 ACP 主链路、人工审批、沙箱升权回归
- **THEN** 既有行为保持；未配置策略的会话默认行为与升级前一致

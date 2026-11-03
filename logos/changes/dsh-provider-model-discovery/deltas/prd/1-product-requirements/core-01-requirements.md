# delta — core-01-requirements.md（变更 dsh-provider-model-discovery）

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

## ADDED — 四、核心场景详述 · S48

### S48: 按供应商 baseURL 动态发现 DeepSeek 模型目录

- **触发条件**：DeepSeek API-key 路由未显式配置人工 `models` 覆盖，调用方读取模型目录、创建 ACP 会话或切换模型。
- **用户价值**：目录、可选项、持久化的 `provider/model` 与最终推理请求使用上游真实模型 ID，不再把内置或预写静态项冒充供应商能力（← P04/P07）。
- **优先级**：P0
- **主路径**：按既有优先级解析显式 `baseURL` → 可信 `DEEPSEEK_BASE_URL` → 公共端点 → 复用当前路由凭据请求 Anthropic Messages 兼容模型列表 → 校验、限界、按上游顺序去重并短时缓存成功结果 → `llm.listModels` 与 ACP `configOptions` 发布同一目录 → `session/set_config_option` 只接受当前目录值 → 推理请求原样使用所选模型 ID。
- **人工覆盖**：显式 `models` 是独立、可见的高级覆盖模式，跳过端点发现；`models: []` 表示明确的空目录。人工配置不得在动态发现失败后自动生效，其他 DeepSeek 路由的既有静态配置语义不因本场景改变。

#### 验收条件
##### 正常：动态目录完整替代默认目录
- **GIVEN** 可控 `baseURL` 返回 `deepseek-v4-flash` 与另一个测试模型
- **WHEN** 调用 `llm.listModels('deepseek-official')` 或创建 ACP 会话
- **THEN** 目录只含端点返回项，ID 原样保留；不出现端点未返回的 `deepseek-flash` 或其他内置项，也不编造上游未提供的能力元数据
##### 正常：URL、凭据与有界读取
- **GIVEN** `/anthropic`、末尾斜杠、已有 `/v1` 或带网关前缀的 baseURL，以及当前路由凭据
- **WHEN** 发起目录发现
- **THEN** 分别请求正确的 `/v1/models` 或 `/models` URL，保留网关前缀，发送 `x-api-key` 与 `anthropic-version: 2023-06-01`；密钥不进入 URL、日志、错误或缓存键，响应头和正文读取均有有限超时且正文累计读取不超过 4 MiB
##### 正常：刷新、缓存与并发
- **GIVEN** 第一次响应为 A/B，第二次响应为 B/C
- **WHEN** 在缓存有效期内重复读取，随后等待 TTL 到期或改变端点、凭据代际或发现配置再读取，并并发发起相同发现
- **THEN** 有效期内复用成功结果；失效后目录为 B/C 且不含 A；相同并发只产生一个上游请求；每个等待者可独立取消，最后一个等待者取消会中止共享传输；失败不缓存，成功空数组可以缓存
##### 异常：失败与成功空目录不得伪装
- **GIVEN** 缺失或不可用凭据、连接失败、超时、401/403、404、429、500、响应过大、非法 JSON、缺少顶层 `data` 数组或成功空 `data`
- **WHEN** 读取目录或构建 ACP options
- **THEN** 失败按凭据、取消、超时、网络/HTTP、过大、JSON/结构分类显式传播且可重试；成功空目录发布为空；两者均不得回退到静态模型，ACP 不得吞错成正常空组
##### 正常：移除模型不重新成为可选项
- **GIVEN** 会话当前模型 A 已被上游目录移除
- **WHEN** 刷新 ACP `configOptions` 或尝试设置模型
- **THEN** A 可保留为 `currentValue` 以描述历史状态，但不进入 choices/options；`session/set_config_option` 拒绝不在本次目录中的值
##### 正常：动态模型切换与精确推理
- **GIVEN** 动态目录包含 `deepseek-v4-flash`
- **WHEN** 通过 ACP 选择该值并发送 prompt
- **THEN** 设置成功，会话继续持久化既有 `provider/model` 字符串，最终上游请求体模型字段原样为 `deepseek-v4-flash`
##### 正常：真实供应商联调
- **GIVEN** staging 已配置真实供应商 `baseURL` 与既有 Secret，目录实际包含 `deepseek-v4-flash`
- **WHEN** 选择该精确 ID 完成推理，再选择目录中另一个实际模型验证
- **THEN** 第一模型返回正常助手响应且请求 ID 与目录 ID 一致；第二模型记录真实结果，权限失败不得伪报成功；无凭据时明确记为未执行，不得以 Mock 代替 AC-6
##### 回归：既有会话与推理行为
- **GIVEN** 既有 S03、S20、S26 会话与模型配置
- **WHEN** 执行会话默认模型、历史回显、下一轮覆盖、恢复、reasoning options 和取消回归
- **THEN** 既有行为保持；一次目录刷新失败不强制中断已有会话的纯推理，但客户端显式读取目录必须收到真实结果或错误

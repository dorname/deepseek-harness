# DeepSeek Harness 需求文档（dsh · core 模块）

> 最后更新：2026-10-06
> 文档性质：存量项目（`bootstrap: adopted`）逆向整理的需求基线，描述 0.2.1-alpha.1（commit `5badb15009`）当前实现所承载的用户需求；场景事实来源为 `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md`（逆向候选，verified:false）中的可验证事实。

## 一、产品背景与目标

### 1.1 产品定位

DeepSeek Harness（`dsh`）是一个开源的 **agent harness（代理运行时框架）**：以「一切皆插件」的 Cordis 架构，为 DeepSeek 及各兼容模型提供可安全执行命令、可持久会话、可嵌入可扩展的代理运行环境（`README.md`、`docs/architecture.md`）。

### 1.2 核心目标

- 让代理在**受控权限**下真实操作工作区（沙箱 + 人工审批 + 全程审计日志）。
- 让产品能力**以插件方式生长**，模型、工具、会话存储、agent loop 均可替换。
- 让同一会话**跨进程存活**：持久化日志、恢复、分叉、压缩、检索。
- 让外部程序（TS/Python/编辑器/CI/webhook）以多种协议**驱动同一运行时**。

### 1.3 目标用户画像

- **个人开发者**：在本地或远程机器上让代理完成仓库级任务，要求对敏感操作有控制权。
- **嵌入方开发者**：把 DSH 作为运行时嵌进自己的产品（编辑器插件、自动化流水线、内部工具），经 SDK/ACP 驱动。
- **运维/自动化**：用 webhook、定时提醒把外部事件转为代理会话。

## 二、用户痛点分析

### P01: 代理执行命令不可控
因为现有编码助手多在内核里直接执行模型指令 → 导致越权写文件/跑命令难以拦截与追溯 → 造成安全事件与误操作损失。证据：`SAFETY.md`、`packages/sandbox/`、`packages/interaction/user-approval/`。

### P02: 能力硬编码、生态封闭
因为传统 harness 把模型/工具/循环写死在核心 → 导致每加一种模型或工具都要改内核 → 能力演进慢、无法按部署裁剪。证据：`docs/architecture.md` §Cordis「no privileged core」。

### P03: 会话即进程，重启即失忆
因为代理状态只活在内存 → 导致进程崩溃/升级后长任务上下文全丢 → 长任务无人敢用。证据：`packages/session/session-persistence-jsonl/`、`session-checkpoint-policy`。

### P04: 模型与外部工具厂商锁定
因为代理代码直连某家 provider API → 导致换模型/接新工具要重写集成 → 迁移成本高、工具生态复用难。证据：`packages/llm/`（适配器缝）、`packages/mcp/`（MCP 桥）。

### P05: 复杂任务单代理硬扛
因为单循环串行处理一切 → 导致上下文膨胀、并行度低、质量下降 → 大任务耗时长且易跑偏。证据：`packages/subagent/`、`packages/workflow/`、`packages/compaction/`。

### P06: 外部事件进不了代理工作流
因为运行时没有事件入口 → 导致 PR 转 ready、定时触发等只能靠人手动粘贴 → 自动化链路断裂。证据：`packages/webhook/`、`packages/schedule/`。

### P07: 嵌入方重复造运行时轮子
因为没有进程外 SDK → 导致每个想嵌代理的产品自建子进程管理、协议、会话格式 → 集成成本高。证据：`packages/sdk/`、`python/sdk/`。

### P08: 人对代理行为失去可见性
因为模型所见与所做不可重建 → 导致无法审计、无法回放、无法分叉修正 → 信任无从建立。证据：`docs/architecture.md`「Model-visible ⟺ logged」。

### P09: 多人共用部署时零隔离
因为 Web 认证是进程级共享启动令牌、全部用户数据收敛在单一 `$DSH_HOME` → 导致团队/组织共享一台自托管部署时任何持令牌者完全等价、跨用户数据互通 → 无法作为多用户运行时使用。证据：`docs/user/guide/public-deployments.md`、`packages/util/home-paths/README.md`。

## 三、场景总览

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

## 四、核心场景详述（P0）

### S01: 启动 Web UI 并运行首个仓库任务
- **触发条件**：用户已安装 Node.js，运行 `npx @deepseek-ai/dsh web` 或源码 `pnpm dsh web`
- **用户价值**：浏览器中获得可交互的受控代理会话（← P01/P02/P08）
- **优先级**：P0
- **主路径**：启动 Web 服务（默认 `127.0.0.1:3080`，打印带启动令牌的 URL）→ 浏览器打开并选择工作区 → Settings→Models 保存 API key → Composer 发送任务 → 代理读文件/跑命令，敏感操作按权限预设请求审批 → 输出结果与交付物。

#### 验收条件
##### 正常：本地完整启动
- **GIVEN** 本机 Node 满足 `^22.19 \|\| >=24` 且 3080 端口空闲
- **WHEN** 用户运行 `dsh web`
- **THEN** 服务监听 127.0.0.1:3080 并在默认浏览器打开带令牌 URL，会话 cookie 经令牌校验后建立
##### 异常：端口占用
- **GIVEN** 3080 已被占用且未传 `--port`
- **WHEN** 用户运行 `dsh web`
- **THEN** 启动失败并输出明确错误，不静默换端口
##### 异常：SSH 远程启动
- **GIVEN** 经 SSH 在远程主机运行 `dsh web`
- **WHEN** Host 就绪
- **THEN** 只打印 URL 不尝试打开本地浏览器（输出说明由 SSH 客户端/编辑器持有本地转发地址）

### S02: 一次性无头任务并打印最终答案
- **触发条件**：终端用户或 CI 运行 `dsh --profile headless "task"`（或 `dsh headless "task"`）
- **用户价值**：无浏览器环境直接获得任务结果，可脚本化（← P01/P03）
- **优先级**：P0
- **主路径**：启动 headless profile → 创建持久化会话 → 代理执行命令/读文件 → 打印最终答案并退出。

#### 验收条件
##### 正常：任务完成
- **GIVEN** 已配置 `DEEPSEEK_API_KEY`（或等价凭证）
- **WHEN** 用户运行 `dsh headless "run the tests"` 且任务成功
- **THEN** 进程退出码为 0，stdout 打印最终答案，会话日志已持久化
##### 异常：缺少凭证
- **GIVEN** 未配置任何可用凭证
- **WHEN** 用户运行 `dsh headless "task"`
- **THEN** 启动即失败并报「缺少凭证」类明确错误，非挂起等待

### S06: Python 程序嵌入 DSH 完成任务
- **触发条件**：Python 开发者安装 `deepseek-harness-sdk` 并构造 `DeepSeekHarness`
- **用户价值**：Python 产品以数行代码获得完整代理运行时（← P07）
- **优先级**：P0
- **主路径**：pip 安装 wheel（含平台 runtime）→ `with DeepSeekHarness(provider, model, cwd, profile="sdk-minimal") as h:` → `h.run(task)` 懒启动 `dsh --profile sdk-minimal` 子进程 → stdio JSON-RPC 驱动 → 返回 `result.final_response`。

#### 验收条件
##### 正常：嵌入运行
- **GIVEN** wheel 已安装且运行时二进制匹配当前平台/架构
- **WHEN** 调用 `h.run("Inspect the repository and fix the failing tests.")`
- **THEN** 返回对象含 `final_response`，子进程在上下文管理器退出时被关闭
##### 异常：runtime 缺失
- **GIVEN** 当前平台无对应预编译 runtime 包
- **WHEN** 构造或首次运行 Harness
- **THEN** 抛出带安装指引的明确异常，不静默降级

### S07: TypeScript 程序驱动 DSH 运行时
- **触发条件**：TS/JS 程序经 `@deepseek-ai/dsh-sdk-client` 启动 `dsh --profile sdk`
- **用户价值**：Node 生态以类型化 API 驱动完整运行时（← P07）
- **优先级**：P0
- **主路径**：客户端解析同版本 `dsh` → spawn stdio 子进程 → `initialize` → 创建/恢复会话、发 prompt → 接收会话事件/通知 → shutdown。

#### 验收条件
##### 正常：会话驱动
- **GIVEN** 客户端与 runtime 版本一致
- **WHEN** 依次调用 initialize → createSession → prompt → 等待完成通知
- **THEN** 客户端收到最终 assistant 消息与状态通知，进程按 shutdown 退出
##### 异常：版本不匹配
- **GIVEN** 客户端与 `dsh` 主版本不一致
- **WHEN** 建立连接
- **THEN** 连接阶段即报错并提示版本对齐要求，不进入半可用状态

### S11: 计划模式：先规划、审批后执行
- **触发条件**：用户在 Composer 输入 `/plan`
- **用户价值**：复杂变更先获人工确认的计划再落地（← P01/P08）
- **优先级**：P0
- **主路径**：进入计划模式（注入部署配置的 `plan:policy` 指引）→ 代理只探索与设计 → 调用 `exit_plan_mode` 提交 markdown 计划 → 用户审批 → 批准后代理开始执行。

#### 验收条件
##### 正常：计划获批执行
- **GIVEN** 会话处于计划模式，代理已完成探索
- **WHEN** 代理调用 `exit_plan_mode` 提交计划且用户在 UI 点「批准」
- **THEN** 计划模式退出事件落会话日志，代理转入执行
##### 异常：用户拒绝计划
- **GIVEN** 计划待审批
- **WHEN** 用户选择拒绝/要求修改
- **THEN** 代理留在计划模式继续修订，不产生任何执行副作用

### S13: 子代理委派（spawn/fork/可延续）
- **触发条件**：父代理调用 `subagent` 工具
- **用户价值**：子任务隔离/继承上下文/长周期交互（← P05）
- **优先级**：P0
- **主路径**：指定 provider（spawn 全新 / fork 继承已完成历史 / 可延续）→ `ctx.subagents` 校验能力并创建 child Session → 子代理运行 → 结果回父代理；可延续子代理经 `send_message` 续聊。

#### 验收条件
##### 正常：spawn 子代理完成
- **GIVEN** 父代理在会话中调用 `subagent`（spawn）且子任务合法
- **WHEN** 子代理运行完成
- **THEN** 父代理收到子代理最终结果，child Session 已持久化且可从父会话追溯
##### 异常：超出递归/并行上限
- **GIVEN** 当前已达部署配置的递归深度或并行容量
- **WHEN** 再次发起子代理
- **THEN** 调用被拒并返回当前上限事实，不产生半创建的 child Session

### S14: workflow 脚本并行编排子代理
- **触发条件**：模型调用 `workflow` 工具提交编排脚本
- **用户价值**：以代码方式表达多代理并行/分支编排（← P05）
- **优先级**：P0
- **主路径**：脚本提交 → `workflow-ptc` 在共享沙箱 Node PTC 运行时执行 → fan-out 子代理 → 收集结果 → 返回最终值。

#### 验收条件
##### 正常：编排完成
- **GIVEN** 脚本语法合法且子代理调用均在授权范围内
- **WHEN** 脚本运行至结束
- **THEN** 工具返回脚本最终返回值，workflow 生命周期事件完整落日志
##### 异常：脚本越权
- **GIVEN** 脚本尝试访问未授权的主机函数
- **WHEN** 执行到越权调用
- **THEN** 该调用被沙箱拒绝并返回拒绝事实，编排按脚本错误路径结算

### S17: GitHub PR ready_for_review 触发审查会话
- **触发条件**：GitHub PR 从 draft 转 ready_for_review，签名事件 POST 到 `/github`
- **用户价值**：外部研发事件自动转为受控审查会话（← P06）
- **优先级**：P0
- **主路径**：配置 `DSH_GITHUB_WEBHOOK_SECRET` + overlay 启动 → 校验签名 → 匹配规则 → `ctx.webhookRuntime` 在对应 Web Workspace 创建 root Session（standard preset + read-only 权限）→ 会话执行只读审查提示并输出结果。

#### 验收条件
##### 正常：签名有效触发会话
- **GIVEN** webhook secret 已配置且事件签名校验通过
- **WHEN** PR 转 ready_for_review
- **THEN** 新 root Session 在对应 Workspace 创建并运行只读审查，会话可被人打开复查
##### 异常：签名无效
- **GIVEN** 请求签名与 secret 不符
- **WHEN** 事件到达 `/github`
- **THEN** 请求被拒（不创建任何会话），拒绝事实被记录

### S21: 敏感工具调用的人工审批
- **触发条件**：敏感操作触发 `ctx.approval.request()`
- **用户价值**：人对敏感操作保有一次性控制权且全程可审计（← P01/P08）
- **优先级**：P0
- **主路径**：敏感操作进入审批 → `user-approval` 按当前会话 approval policy（ask/never）分发 → Web UI answerer 弹审批 → 用户允许/拒绝 → `approval/asked` + `approval/decided` 审计事件落日志 → 工具按结果执行或失败。

#### 验收条件
##### 正常：用户允许
- **GIVEN** 会话 approval policy 为 `ask`，敏感操作待审批
- **WHEN** 用户在审批卡上点「允许」
- **THEN** 工具以获批参数执行，asked/decided 事件成对落日志
##### 异常：审批无 answerer（fail-closed）
- **GIVEN** 无任何 answerer 可响应审批（如无 UI 的自动化上下文且策略为 ask）
- **WHEN** 敏感操作请求审批
- **THEN** 审批按失败关闭语义拒绝执行，操作不落地

### S22: 沙箱内执行命令并申请权限升级
- **触发条件**：模型在 bash 工具调用中声明更宽的 `sandbox_permissions` + `justification`
- **用户价值**：默认最小权限、按需升级且升级有理由留痕（← P01）
- **优先级**：P0
- **主路径**：命令在受限模式被拒 → 返回 `[sandbox: file access denied under <mode> mode]` 事实 → 模型带理由重试 → 经审批获批 → 以新沙箱模式执行。

#### 验收条件
##### 正常：升级获批执行
- **GIVEN** 会话沙箱为 `workspace-write`，命令需写工作区外路径
- **WHEN** 模型以 `sandbox_permissions` + `justification` 重试且用户批准
- **THEN** 命令以获批模式执行，审批与执行事实均落日志
##### 异常：越界写被拒
- **GIVEN** 沙箱为 `read-only`
- **WHEN** 模型直接发起写操作
- **THEN** 写被沙箱拦截返回拒绝事实，不产生任何文件副作用

### S31: 用户经认证网关登录并进入自己的 Harness
- **触发条件**：用户浏览器访问 fleet 部署的网关地址，且当前无有效网关会话
- **用户价值**：团队/组织共享一台自托管部署时，每人经自己的身份登录、进入自己的隔离 Harness（← P09）
- **优先级**：P0
- **主路径**：浏览器访问网关 → 未认证请求重定向到 OIDC 提供方登录 → 认证回调建立网关会话 → fleet 管理器确保该用户专属 dsh Host 进程运行（首次登录自动开通，注入该用户专属 `$DSH_HOME`）→ 网关反向代理到该进程 loopback 端口 → 用户在既有 Web UI 中正常使用（S01 全流程在其专属进程内成立）。

#### 验收条件
##### 正常：首次登录自动开通
- **GIVEN** fleet 部署运行中，用户首次以有效 OIDC 身份完成登录
- **WHEN** 网关完成认证回调
- **THEN** fleet 管理器以该用户专属 `$DSH_HOME` 拉起其 dsh web 进程，网关路由就绪，用户进入自己的 Web UI（会话列表、设置均为该用户专属数据）
##### 异常：认证失败不开通
- **GIVEN** 用户在 OIDC 提供方登录失败或拒绝授权
- **WHEN** 回到网关
- **THEN** 网关返回明确的未认证反馈，不为该用户拉起任何 dsh 进程

### S32: 跨用户数据不可达
- **触发条件**：用户 B 在同一 fleet 部署上尝试触达用户 A 的数据（会话 URL、会话列表、附件、凭证、设置、审批卡）
- **用户价值**：隔离是服务端强制属性而非前端隐藏（← P09/P01/P08）
- **优先级**：P0
- **主路径**：B 认证后查看自己的会话列表（只见自己的）→ B 直接构造指向 A 会话/附件的 URL → 网关按会话归属拒绝 → B 得到明确的拒绝反馈 → A 的进程与数据不受影响。

#### 验收条件
##### 正常：跨用户访问被拒
- **GIVEN** 用户 A 与 B 均已登录，A 存在历史会话
- **WHEN** B 携自己的网关会话访问 A 的会话 URL
- **THEN** 请求被网关拒绝（A 的 dsh 进程不受理 B），B 得到明确拒绝反馈，A 无感知
##### 异常：审批路由隔离
- **GIVEN** A 的会话有敏感操作待审批，B 同时在线
- **WHEN** 审批事件分发
- **THEN** 审批卡只出现在 A 的浏览器；B 的界面无此审批且无法代答

## 五、约束与边界

### 5.1 技术约束
- Node `^22.19 || >=24`，全仓 ESM；`dsh` 源码启动依赖 tsx ESM-only hook（`AGENTS.md`）。
- 真实模型调用需 `DEEPSEEK_API_KEY`（或配置的第三方 provider 凭证）；无 key 时 e2e 自跳过（`docs/testing.md`）。
- 公开 API 处于 developer preview，**会有兼容性破坏变更**（`README.md`）。
- 会话日志格式为已发布数据：代际路径不可改名/删除，只能经相邻迁移递增版本（AGENTS.md）。

### 5.2 资源与时间约束
- 开源社区驱动；CI 承担全平台矩阵与覆盖率门禁（per-file 100% on `packages/*/*/src`）。

### 5.3 "不做"清单
- 不做厂商托管多租户 SaaS 后端（多用户能力以**自托管 fleet** 形态交付：认证网关 + 每用户独立进程与数据目录，见 S31–S33；由厂商运营的托管 SaaS 仍不在产品范围）。
- 不做模型训练/微调；harness 只消费模型 API。
- 不内置 IDE；编辑器集成走 ACP/SDK/hooks 桥，不重复造 IDE。
- 不承诺 API 稳定（pre-stable，升级即破坏需走 upgrade guide 记录）。

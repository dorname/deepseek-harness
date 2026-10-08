# delta — core-01-requirements.md（变更 agent-runner-pool）

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

## MODIFIED — 四、核心场景详述（P0）

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

### S34: 共享会话世代的跨节点读写与崩溃恢复
- **触发条件**：部署以 Postgres 持久化后端启动，两个 Host 节点指向同一共享库
- **用户价值**：会话不再锚定单机磁盘——任一节点可打开同一用户的历史会话，已提交世代不可变与写式互斥语义在共享层保持（← P03/P09）
- **优先级**：P0
- **主路径**：节点 A 创建会话并写入（世代独占发布）→ 节点 B 经同一共享层 stat/list 看到该会话 → B open 读到与 A 一致的当前逻辑事件 → A 写式中断（进程消失）→ B（或重启后的 A）按既有恢复语义打开，未封口中断尾合成收尾 → 世代指针始终单调。

#### 验收条件
##### 正常：双节点互见
- **GIVEN** 节点 A 在共享层创建会话并提交至少一个世代
- **WHEN** 节点 B 以同一共享层配置 `list`/`open` 该会话
- **THEN** B 看到该会话且解码出的事件与 A 提交内容一致，头信息与 A 的最新世代一致
##### 正常：崩溃恢复
- **GIVEN** A 持写式句柄写入过程中进程消失，留下未封口中断尾
- **WHEN** B（或重启后的 A）打开该会话
- **THEN** 未封口中断尾按既有 repair 语义合成缺失收尾事件，已提交世代路径与字节不变
##### 异常：写式互斥
- **GIVEN** A 持有该会话的写式句柄且未释放
- **WHEN** B 尝试以写式打开同一会话
- **THEN** B 得到明确的占用失败，不出现双写者
##### 异常：未来版本拒绝
- **GIVEN** 共享层存在高于本节点所支持逻辑格式的代际
- **WHEN** 打开该会话
- **THEN** 明确拒绝并报格式版本事实，不静默降级或丢弃数据

### S35: 共享域数据的每用户命名空间
- **触发条件**：多个用户进程共享同一 Postgres KV 后端
- **用户价值**：schedule/workspace/投影缓存等域数据获得共享承载，命名空间由提供方强制注入、域实现零感知（← P09/P01）
- **优先级**：P0
- **主路径**：各 Host 进程以自己的 fleet subject 启动 → storage 提供方为该用户的每个域 unit 派生用户专属命名空间（unit 名派生自 fleet subject）→ 用户 A 的域读写只落在 A 的命名空间 → B 经自己的进程只能触达 B 的命名空间 → 未注入 fleet 身份的单机进程使用与现状一致的默认命名空间。

#### 验收条件
##### 正常：命名空间互不可见
- **GIVEN** A 与 B 两个进程共享同一 Postgres KV 层
- **WHEN** A 写入域键 `k`，B 经自己的进程读写同名键 `k`
- **THEN** B 读到的是 B 自己命名空间的独立值，永远读不到 A 写入的值
##### 正常：单机行为不变
- **GIVEN** 进程未注入 fleet 身份（单机模式）
- **WHEN** 域读写
- **THEN** 键无命名空间前缀，行为与既有本地后端一致
##### 异常：域 API 不暴露跨命名空间寻址
- **GIVEN** A 进程已注入自己的命名空间
- **WHEN** A 经域 KV API 以 B 的域键名读写
- **THEN** 该读写落在 A 自己的命名空间内（域 API 不提供跨命名空间寻址入口），触达不到 B 的数据

### S36: 附件与溢出的共享存取
- **触发条件**：会话附件/溢出字节写入共享存储后端
- **用户价值**：附件与溢出随共享层存活，任一节点可取回，字节内容跨节点一致（← P03/P09）
- **优先级**：P1
- **主路径**：用户在节点 A 为会话附加文件 → 字节写入共享附件后端（该用户命名空间内）→ 元数据落会话日志 → 节点 B 打开同一会话 → 按日志中的键从共享层取回字节 → 内容一致。

#### 验收条件
##### 正常：跨节点取回一致
- **GIVEN** 节点 A 成功上传附件并提交会话
- **WHEN** 节点 B 打开同一会话并按日志中的附件键读取字节
- **THEN** 取回字节与 A 上传内容逐字节一致
##### 异常：缺失键明确报错
- **GIVEN** 附件键在共享层不存在
- **WHEN** 按该键读取
- **THEN** 返回明确的 not found 失败，不返回空字节或静默成功

### S37: 会话租约的跨节点单写者
- **触发条件**：部署指向共享 Postgres 的执行池（runner ×N），同一会话同时被两个 runner 触发执行，或持有租约的 runner 崩溃
- **用户价值**：同一会话任意时刻至多一个活跃执行者（无双写、无重复副作用），runner 崩溃后会话在租约过期内被其他节点接管续跑（← P03/P09）
- **优先级**：P0
- **主路径**：runner 取派发项 → 在租约表原子获取该会话租约（持有者 + 过期时刻）→ 心跳续约 → 执行 turn → 空闲释放；另一 runner 对同一会话的获取被明确拒绝 → 转为等待。

#### 验收条件
##### 正常：获取-续约-释放
- **GIVEN** 会话无租约
- **WHEN** runner A 获取租约并周期续约
- **THEN** A 持续持有（`ownerOf` 恒为 A）；A 释放后其他 runner 可立即获取
##### 异常：竞争恰一胜者
- **GIVEN** 会话租约被 A 持有且未过期
- **WHEN** runner B 尝试获取
- **THEN** B 得到明确的占用拒绝（可等待重试），无双持有者
##### 异常：过期接管
- **GIVEN** A 的租约超过有效期未续约（进程崩溃）
- **WHEN** runner B 尝试获取
- **THEN** B 原子接管成功且恰一胜者；接管点从 durable 日志重放 + inbox 投影接续，只在 turn 边界恢复

### S38: 队列派发与 inbox 投影接续
- **触发条件**：用户向会话发送消息（或 webhook 事件创建会话），执行池有多个 runner
- **用户价值**：任一空闲 runner 都能接续任一会话——派发只投会话 id，接续依赖共享持久层日志与 durable inbox 投影（← P03/P06）
- **优先级**：P0
- **主路径**：网关/入口把会话 id 写入派发队列（去重）→ LISTEN/NOTIFY 唤醒 + 轮询兜底 → 空闲 runner 取队首 → 获取会话租约 → `agents.resume` 从共享层加载会话并按 inbox 投影接续未消费输入 → turn 完成后按空闲策略释放。

#### 验收条件
##### 正常：派发接续
- **GIVEN** 会话在共享层有历史与未消费 inbox 输入
- **WHEN** 队列投递该会话且 runner 取得租约
- **THEN** runner 恢复会话并消费 inbox 输入继续执行，事件落到共享层
##### 异常：持有者崩溃后接续
- **GIVEN** runner A 正在执行 turn 时被 kill
- **WHEN** 租约过期且队列仍有该会话
- **THEN** 其他 runner 接管并继续 inbox 中未消费输入，无重复执行的副作用（接管点为 turn 边界）

### S39: 流中继的跨副本实时
- **触发条件**：runner 执行中产出 assistant-stream 帧与会话事件，浏览器连到非属主 Web/API 副本
- **用户价值**：任何副本都能为浏览器提供同一会话的实时流式输出与事件增量，读取面不再绑定属主节点（← P08）
- **优先级**：P1
- **主路径**：runner 把 `session/event` 与 assistant-stream 帧按单调序号发布到中继日志表并以 NOTIFY 唤醒 → 副本订阅该会话频道，从冷读游标起追赶 → 转发给自己的浏览器 follow 连接（Session-follow 语义不变）。

#### 验收条件
##### 正常：双副本同看流
- **GIVEN** runner A 执行会话 S，副本 B1/B2 均订阅
- **WHEN** A 持续产出帧与事件
- **THEN** B1 与 B2 按相同序号收到相同记录，浏览器 follow 实时到达
##### 异常：订阅者从游标追赶
- **GIVEN** 副本在中途才订阅
- **WHEN** 提供其已冷读到的最大序号
- **THEN** 中继从该序号之后完整回放，无缺口无重复

## MODIFIED — 5.3 "不做"清单

### 5.3 "不做"清单
- 不做厂商托管多租户 SaaS 后端（多用户能力以**自托管 fleet** 形态交付：认证网关 + 每用户独立进程与数据目录，见 S31–S33；由厂商运营的托管 SaaS 仍不在产品范围）。
- 不做模型训练/微调；harness 只消费模型 API。
- 不内置 IDE；编辑器集成走 ACP/SDK/hooks 桥，不重复造 IDE。
- 不承诺 API 稳定（pre-stable，升级即破坏需走 upgrade guide 记录）。
- 不做跨用户集中检索与管理面：共享持久层（S34–S36）只以每用户命名空间承载数据，不提供任何跨命名空间的查询、浏览或管理入口；Postgres FTS 集中化与 KMS 集中凭证按落地方案（multi-user-and-cluster-plan §6-3/§6-5）延后到后续里程碑。
- 不做执行池的 Redis pub/sub 中继与 PTY 进程远程化：M3 中继用 PostgreSQL `LISTEN/NOTIFY` + 中继日志表（零新增基础设施依赖，Redis 为后续 Provider）；终端/jobs 只落「属主信息面」（`ownerOf` 路由决策），PTY 远程化（ssh 式远程世界）与 Web/API 副本无状态化编排、K8s Operator（multi-user-and-cluster-plan §7-4/§9）延后到后续里程碑。

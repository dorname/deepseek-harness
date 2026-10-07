# core 功能规格（feature-design）

> 最后更新：2026-10-07
> 文档性质：存量项目逆向整理的产品设计基线，描述 0.2.1-alpha.1 已交付功能的交互规格；场景编号与 Phase 1（`core-01-requirements.md`）一致。

## 0. 产品类型判断

混合型产品，四个交付面：

| 交付面 | 产品类型 | 原型形式（本基线以现状描述替代新制原型） |
|---|---|---|
| `dsh` CLI | CLI 工具 | 终端交互规格 + 输出模拟 |
| Web GUI（`dsh web`） | Web 应用 | 现有界面结构描述（已实现，见 `packages/client/`） |
| Desktop（Electron） | 桌面应用 | 现有窗口/菜单/托盘结构描述（见 `apps/desktop`） |
| TS/Python SDK、ACP | 库 / SDK | API 使用规格（已实现，见 `packages/sdk`、`packages/acp`） |

## 1. 信息架构

### 1.1 CLI 命令结构（`apps/cli/src/args.ts:146-204`）

```text
dsh [--profile <name>] [--from-default-profile <name>] [--patch <path>...]
    [--dump-config | --dump-config-schema | --dump-default-config] [-V]
dsh <name>            # 位置简写 = --profile <name>（plugin/desktop 保留）
dsh plugin --profile <name> [add|remove|list|why|...]   # 转发 profile 内 pnpm
[args...]             # 启动器不认识的参数原样透传给 app 插件（如 --port、--no-open）
```

内置 profile：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`；共享首层 `dsh-base`。

### 1.2 Web GUI 结构（`packages/client/` 各 ui 包，已实现）

- 三栏 AppFrame（`dsh-client-ui-layout`）；左侧会话多级树/搜索/分组（`ui-sidebar`）。
- 中间会话区：Conversation 组装、Composer、队列、审批接管卡（`ui-conversation`、`ui-approval`、`ui-user-questions`）、计划卡（`ui-plan`）、交付/变更卡（`ui-deliverables`）、轨迹账本（`ui-trajectory`）。
- 右侧 Dock：文件树、终端、Office/Markdown/图片预览、浏览器页签（`ui-sidebar-right`、`ui-sidebar-files`、`ui-sidebar-terminal`、`ui-sidebar-documentpreview`、`ui-sidebar-browser`）。
- 设置域：General / Models / Plugins（含 Loader 清单）/ 各插件配置页（`ui-settings-*`）。
- 命令面：`/` 命令目录（`ui-commands`）、`@` 引用（文件/会话，`ui-reference`）。

### 1.3 Desktop 窗口/菜单结构（`apps/desktop`，已实现）

- Electron 单窗口 + persistent WebContentsView（Platform 页内嵌）；关闭按钮→后台运行询问；Dock/托盘/`dsh://open` 恢复。
- 菜单：Manage dsh Command…（安装/修复/移除系统 `dsh`）、Check for Updates…。

### 1.4 SDK / ACP 结构

- SDK 协议：newline-delimited JSON-RPC over stdio（`dsh-sdk-protocol`）；会话/事件/通知类型化（`dsh-sdk-client`、`dsh-sdk-jsonrpc-server`）。
- ACP：Agent Client Protocol 的 automation-only 子集（`dsh-acp`）。
- Python：`DeepSeekHarness`（高层 turns API）+ `HarnessClient`（低层 RPC）。

## 2. P0 场景交互规格

### S01: 启动 Web UI 并运行首个仓库任务 — 交互规格

**命令格式**：`dsh web [--host <h>] [--port <p>] [--public-url <u>] [--trusted-host <a...>] [--no-open]`

**交互流程**：
1. 终端运行 `dsh web` → 组合 bundle 层 + patch 层 → Host 就绪打印 `dsh web: http://127.0.0.1:3080/?token=...`
2. 本地启动自动打开浏览器；SSH 或 `--no-open` 只打印 URL
3. 浏览器以 token 换会话 cookie → 进入工作区选择 → 无 key 时 Settings→Models 引导保存
4. Composer 发送任务 → 会话区流式渲染 → 敏感操作弹审批卡 → turn 末渲染交付卡/变更卡

**终端输出模拟（正常路径）**：
````text
$ dsh web
dsh web: http://127.0.0.1:3080/?token=7f3a…c1
````

**终端输出模拟（异常：desktop profile 直启）**：
````text
$ dsh desktop
Error: profile "desktop" is reserved for the Desktop application.
Run the Desktop app instead, or set manageDesktopProfile=true explicitly.
````

#### 验收条件（交互级）

##### 正常：本地启动并打开浏览器
- **GIVEN** 3080 空闲且为本地终端
- **WHEN** 用户运行 `dsh web`
- **THEN** 10 秒内打印带 token 的 URL 且默认浏览器被打开，退出码保持前台运行
##### 异常：端口占用
- **GIVEN** 3080 被占用
- **WHEN** 用户运行 `dsh web`（未传 `--port`）
- **THEN** 启动失败并打印端口占用错误，退出码非 0

### S02: 一次性无头任务 — 交互规格

**命令格式**：`dsh headless [--json] [--session-id <id>] [task...]`

**交互流程**：
1. `dsh headless "run the tests"` → 启动 headless bundle（无 Host/HTTP/浏览器层）
2. 创建新的持久化会话并注入任务 → 代理运行命令/读文件
3. 任务结束打印最终答案并退出；`--json` 时输出结构化结果

**终端输出模拟（正常路径）**：
````text
$ dsh headless "run the tests"
…（执行过程日志）…
Final: 42 tests passed, 0 failed. Suite green.
````

#### 验收条件（交互级）

##### 正常：成功完成
- **GIVEN** 凭证已配置
- **WHEN** `dsh headless "run the tests"` 任务成功
- **THEN** 退出码 0，stdout 末段打印最终答案，会话可在 `dsh web` 会话列表中找到
##### 异常：缺少凭证
- **GIVEN** 无任何凭证
- **WHEN** 运行该命令
- **THEN** 启动阶段失败并提示缺少凭证，退出码非 0

### S06: Python 嵌入 — 交互规格（API 使用规格）

**接口**：`DeepSeekHarness(provider, model, cwd, *, dsh_home, profile='sdk-minimal')`，`run(task, session_id=...) -> RunResult`

**使用示例**：
```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness("deepseek", "deepseek-chat", cwd=".") as harness:
    result = harness.run("Inspect the repository and fix the failing tests.")
    print(result.final_response)
```

**行为规范**：
- 首次 `run` 懒启动 `dsh --profile sdk-minimal` 子进程并复用；上下文管理器退出时关闭
- runtime 缺失时抛带安装指引的异常，不静默降级

#### 验收条件（交互级）

##### 正常：嵌入运行
- **GIVEN** wheel 已安装、平台有预编译 runtime
- **WHEN** 上述代码执行
- **THEN** 打印最终答案，`result` 含最终响应字段，进程干净退出
##### 异常：平台无 runtime
- **GIVEN** 当前平台/架构无预编译包
- **WHEN** 首次运行
- **THEN** 抛出明确异常并附安装/平台说明

### S07: TypeScript SDK — 交互规格（API 使用规格）

**接口**：`DeepSeekHarness`（高层）/ `HarnessClient`（低层），包 `@deepseek-ai/dsh-sdk-client`

**使用示例**：
```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const harness = new DeepSeekHarness({ profile: 'sdk' })
await harness.run('Summarize this repository.')
await harness.dispose()
```

#### 验收条件（交互级）

##### 正常：驱动会话
- **GIVEN** 客户端与 dsh 版本一致
- **WHEN** initialize → createSession → prompt → 完成通知
- **THEN** 收到最终 assistant 消息，dispose 后子进程退出
##### 异常：版本不匹配
- **GIVEN** 主版本不一致
- **WHEN** 建立连接
- **THEN** 连接阶段报错提示对齐版本

### S11: 计划模式 — 交互规格（Web 交付面）

**触发**：Composer 输入 `/plan` → `ctx.planMode` 激活，系统提示注入部署 `plan:policy`

**交互流程**：
1. 计划模式期间 Composer 显示模式标识；代理只读探索
2. 代理调用 `exit_plan_mode` 提交 markdown 计划 → 会话区渲染计划卡
3. 用户「批准」→ 退出计划模式并转入执行；「拒绝/继续规划」→ 代理留在模式内修订

#### 验收条件（交互级）

##### 正常：批准
- **GIVEN** 计划卡已渲染
- **WHEN** 用户点「批准」
- **THEN** 计划模式退出事件落日志，代理开始执行，计划卡转已批准态
##### 异常：拒绝
- **GIVEN** 计划卡已渲染
- **WHEN** 用户点「拒绝」
- **THEN** 代理保持计划模式，无任何执行副作用，卡上显示拒绝反馈

### S13: 子代理委派 — 交互规格（对话式）

**触发**：父代理调用 `subagent`（参数：provider、task、model 等；可延续模式返回 child id）

**对话流程**：
1. 父代理：`subagent(provider="spawn", task="...")`
2. `ctx.subagents` 校验能力/上限 → 创建 child Session → 驱动子代理
3. 子代理完成 → 结果回父代理工具结果；可延续子代理可被 `send_message` 续聊、`list_agents` 发现

#### 验收条件（交互级）

##### 正常：spawn 完成
- **GIVEN** 未达递归/并行上限
- **WHEN** 子代理运行完成
- **THEN** 父代理收到最终输出，child Session 持久化且父会话可引用
##### 异常：超限拒绝
- **GIVEN** 已达部署配置上限
- **WHEN** 再次委派
- **THEN** 工具返回上限事实，无 child Session 残留

### S14: workflow 编排 — 交互规格（对话式）

**触发**：模型调用 `workflow`，参数为编排脚本（JS，async main，调用主机提供的 `subagent` 等函数）

**行为规范**：
- 脚本在共享沙箱 Node PTC 运行时执行；越权调用被沙箱拒绝并返回拒绝事实
- 生命周期经 `workflow/*` 事件落会话日志；Web 以 workflow-run 节点渲染

### S17: GitHub webhook — 交互规格（HTTP 入口）

**入口**：`POST /github`（`webhook-github` 注册到 `ctx.webServer`）

**交互流程**：
1. 以 `DSH_GITHUB_WEBHOOK_SECRET` 校验签名
2. 事件过滤（PR ready_for_review）→ 规则返回会话创建请求
3. `ctx.webhookRuntime` 在对应 Workspace 创建 root Session（standard preset + read-only）并注入审查提示

#### 验收条件（交互级）

##### 正常：触发审查
- **GIVEN** secret 已配置、签名有效
- **WHEN** PR 转 ready_for_review
- **THEN** 新 root Session 创建并运行只读审查，Web 会话树可见
##### 异常：签名无效
- **GIVEN** 签名不符
- **WHEN** POST 到达
- **THEN** 返回拒绝且不落任何会话创建副作用

### S21: 人工审批 — 交互规格（Web 交付面）

**触发**：敏感操作 → `ctx.approval.request()` → 按会话 approval policy 分发

**交互流程**：
1. Web answerer 渲染审批卡（操作、参数、理由）
2. 用户允许/拒绝 → `approval/decided` 落日志 → 工具继续或失败
3. 无 answerer 可响应时 fail-closed 拒绝

### S22: 沙箱升级 — 交互规格（对话式 + Web）

**触发**：bash 工具调用带 `sandbox_permissions` + `justification`

**交互流程**：
1. 受限命令被拒，工具结果含 `[sandbox: file access denied under <mode> mode]`
2. 模型同 turn 带理由重试 → 触发审批卡 → 用户批准后以新模式执行

## 3. 原型索引（指向已实现交付面）

本基线不新制 HTML 原型（产品已交付运行）。各交付面的可运行原型即产品本身：

- CLI 终端行为：`pnpm dsh --profile headless "task"`（需 key）或 `--dump-config`
- Web GUI：`pnpm dsh web`
- Desktop：`make desktop`
- SDK 示例：`examples/`、`python/sdk` 示例

## 4. fleet 交付面交互规格（S31–S33）

fleet（User Fleet）是部署形态能力：一台自托管机器上为多个用户提供相互隔离的 Harness。用户可感知面是「登录即进入自己的 Web UI」；运维可感知面是 fleet 管理器的部署配置与结构化日志。dsh Web 客户端界面不变（`ui_impact: false`），登录页由外部 OIDC 提供方承载。

### S31: 网关登录 — 交互规格（fleet Web 交付面）

**入口**：用户浏览器访问 fleet 网关地址（部署配置的对外 URL，如 `https://dsh.<org>.example`）

**交互流程**：
1. 未认证请求 → 网关重定向到 OIDC 提供方登录页（页面由提供方承载，网关不自绘、不新增自研页面）
2. 登录成功回调 → 网关建立网关会话 cookie，绑定身份（subject）→ 映射到该用户专属 dsh Host 进程（首次登录自动开通）
3. 之后所有请求由网关反向代理到该进程的 loopback 端口；用户在既有 Web UI 中操作，S01 交互不变
4. 网关会话过期/登出 → 后续请求重新走 OIDC 认证

**运维面（部署配置，非自绘页面）**：OIDC issuer/client、用户 home 根目录、并发上限、空闲回收阈值均为部署配置项（cordis.yml/环境变量；校验失败 loud fail）。

#### 验收条件（交互级）

##### 正常：登录进入专属 Harness
- **GIVEN** fleet 部署运行、用户身份有效
- **WHEN** 完成 OIDC 登录
- **THEN** 进入自己的 Web UI；会话列表、设置均为该用户专属数据
##### 异常：未认证访问深链
- **WHEN** 未认证直接访问指向某会话的 URL
- **THEN** 重定向登录；登录后原 URL 属于本人则回到原 URL，不属于本人按 S32 拒绝

### S32: 跨用户隔离验证 — 交互规格（fleet Web 交付面）

**触发**：任一用户尝试触达另一用户的数据（会话 URL、列表、附件、凭证、设置、审批卡）

**行为规范**：
1. 会话列表、搜索、附件、凭证、设置只含本用户数据——由「每用户独立进程 + 独立 `$DSH_HOME`」在服务端强制，非前端隐藏
2. 跨用户 URL 请求 → 网关返回明确拒绝（403 类），不泄露属主数据内容
3. 审批卡、提问卡只投递给属主用户的浏览器连接；其他用户不可见、不可代答

### S33: 进程生命周期 — 交互规格（fleet 运维面）

**行为规范**：
1. **开通**：首次登录自动 spawn 该用户 `dsh --profile web` 进程（OS 分配端口，注入该用户专属 `$DSH_HOME`）
2. **回收**：空闲超过阈值（配置项）自动回收进程；该用户下次访问自动重新开通，会话数据从其 home 恢复
3. **重启**：用户进程崩溃由 fleet 管理器自动重启；其他用户进程不受影响
4. **上限**：并发用户进程数达配置上限后，新登录请求得到明确反馈（拒绝或按配置排队），不静默超载
5. **资源约束（验收执行）**：并发上限与空闲回收是 CPU/内存占用的主旋钮；staging 验收与冒烟以小并发上限运行、冒烟用例串行执行，主机 CPU 利用率不得超过部署配置的阈值

**运维观测**：fleet 管理器输出结构化日志（开通/回收/重启/拒绝事件）；M1 不提供自绘管理页面。

## 5. 共享持久层交互规格（S34–S36）

共享持久层是部署形态能力：把 M1 达成的「每用户独立进程 + 独立 `$DSH_HOME`」中的**数据承载**升级为可共享的 Postgres 后端，使会话世代、域 KV、附件/溢出不再锚定单机磁盘。用户可感知面不变（同一 Web UI、同一会话列表，`ui_impact: false`）；可感知变化是「任一节点都能打开同一用户的历史会话」。运维可感知面是新后端的部署配置（cordis.yml 指定后端与连接串；配置缺失/不可达 loud fail）。

三条缝全部走既有抽象（`SessionPersistence`、storage KV、`AttachmentStore`/`SpillStore`），核心缝签名零改动；每用户命名空间由提供方层强制，域实现、KV 后端、附件消费方零感知。

### S34: 共享会话世代读写 — 交互规格（运维/开发面）

**入口**：部署以 Postgres 持久化后端启动（`session-persistence-postgres` 插件），两个 Host 节点指向同一共享库

**行为规范**：
1. **世代语义与 JSONL 对齐**：已提交世代不可变、只增不改；发布独占（同名世代重复发布即冲突错误）；未物化事件在「尾」中，读路径永不回读中断尾
2. **写式互斥**：写式打开经共享库的锁原语互斥——A 持写式句柄期间 B 写式打开得到明确占用失败；close 释放所有权，后续写从已提交 next-seq 续写
3. **崩溃恢复**：写式中断留下未封口尾，下一次打开按既有 repair 语义合成收尾；已提交世代路径与字节不变
4. **格式门**：高于本节点认知的代际格式明确拒绝（`SessionFormatUnsupportedError` 同族），不静默降级
5. **契约等价**：后端必须通过与 JSONL 相同的缝契约套（`runPersistenceContract` / `runLiveWritePathContract`），拒绝行为、freshness、单写者所有权语义逐条一致

#### 验收条件（交互级）

##### 正常：双节点互见
- **GIVEN** 节点 A 在共享层创建会话并提交 ≥1 个世代
- **WHEN** 节点 B list/open 同一会话
- **THEN** 事件与头信息与 A 提交内容一致
##### 异常：写式占用
- **GIVEN** A 持写式句柄未释放
- **WHEN** B 写式打开同一会话
- **THEN** B 得到明确占用失败，无双写者
##### 异常：torn tail 不回读
- **GIVEN** 共享层存在中断尾
- **WHEN** 任意节点读该会话
- **THEN** 中断尾不进入读取结果，写式打开时被修复

### S35: 共享域数据命名空间 — 交互规格（运维/开发面）

**入口**：多用户进程共享同一 Postgres KV 后端（`storage-postgres`，与 `storage-sqlite` 并列注册）

**行为规范**：
1. **命名空间注入点在提供方层**：注入了 fleet 身份（`DSH_FLEET_USER_ID`）的进程，其全部域 unit 派生为用户专属命名空间（unit 名派生自 subject）；域声明、域实现、KV 后端零改动
2. **默认命名空间**：未注入 fleet 身份的单机进程使用与现状一致的默认命名空间，行为不变
3. **域 API 不暴露跨命名空间寻址**：域 KV API 的键空间在命名空间内闭合，不存在以另一用户身份寻址的入口
4. **全局槽位按用户分离**：域 global（如 workspace 单例状态）随命名空间天然分离，不共享

#### 验收条件（交互级）

##### 正常：命名空间互不可见
- **GIVEN** A 与 B 进程共享同一 KV 层，A 写入域键 `k`
- **WHEN** B 经自己的进程读写同名键 `k`
- **THEN** B 操作的是自己命名空间的独立值，读不到 A 的值
##### 正常：单机行为不变
- **GIVEN** 进程未注入 fleet 身份
- **WHEN** 域读写
- **THEN** 行为与既有本地后端一致

### S36: 共享附件存取 — 交互规格（开发面）

**入口**：会话附件/溢出写入共享后端（`attachment-postgres` / `spill-postgres`，与 local 实现并列）

**行为规范**：
1. **引用不变**：附件/溢出引用仍是后端自造的不透明 id（内容寻址），消费方不解析、不感知存储介质
2. **命名空间随属主**：对象按属主用户的命名空间承载；读取按引用键直达属主数据，无跨命名空间列举入口
3. **最小实现面**：图像存取（saveImage/readImage）先落地；文件流与 request 投影能力按缝默认拒绝实现，后续按需补齐
4. **缺失明确报错**：引用键不存在时返回明确 not found，不返回空字节

#### 验收条件（交互级）

##### 正常：跨节点取回一致
- **GIVEN** 节点 A 上传附件成功并提交会话
- **WHEN** 节点 B 打开同一会话按引用读取
- **THEN** 字节与上传内容逐字节一致
##### 异常：缺失键
- **GIVEN** 引用键不存在
- **WHEN** 按该键读取
- **THEN** 明确 not found

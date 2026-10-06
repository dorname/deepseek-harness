# core S01–S10（入口与接入域）— 测试用例

> 最后更新：2026-10-06
> 批注：存量项目逆向测试基线；按域分批组织（每批一个文件）以控制文件数量，用例 ID 仍全局限定。场景来源 `core-01-requirements.md`；实现事实（被测对象）见 `core-system-map.md` / `core-entry-points.md`。

## S01: 启动 Web UI 并运行首个仓库任务

### 1.1 单元测试用例（来源：CLI 参数解析与 web 启动）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-01 | 位置简写解析为 profile | `apps/cli/src/args.ts:202-204` | 无 | `dsh web` | profile=web，透传参数为空 |
| UT-S01-02 | `--dump-config` 不启动应用 | `apps/cli/src/args.ts:171` | profile 存在 | `--profile web --dump-config` | 打印组合树后退出 0 |
| UT-S01-03 | desktop profile 默认拒直启 | `apps/cli/src/args.ts:83-87` | 未设 manageDesktopProfile | `dsh desktop` | 明确错误 + 非 0 退出 |

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S01-01 | 本地启动并打开浏览器 | S01-AC-01 | Node 合规、3080 空闲 | `dsh web` → 等就绪 | 打印 `dsh web:` URL；本地打开浏览器；cookie 经令牌建立 |
| ST-S01-02 [manual] | SSH 启动只打印 URL | S01-AC-03 | SSH 会话 | 远程 `dsh web` | 不触发本地浏览器打开（人工观察输出说明） |
| ST-S01-03 | 端口占用 fail-loud | S01-AC-02 | 3080 被占 | `dsh web`（无 --port） | 启动失败 + 明确端口错误 + 非 0 退出 |

## S02: 一次性无头任务并打印最终答案

### 1.1 单元测试用例

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S02-01 | `--json` 输出结构 | `packages/bundle/headless/src/startup.ts:43-45` | 有 key | `dsh headless --json "hi"` | stdout 为合法 JSON 且含最终答案字段 |
| UT-S02-02 | `--session-id` 指定会话 | 同上 | 会话 id 合法 | `--session-id x task` | 复用/创建指定 id 会话 |

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S02-01 | 任务成功完成 | S02-AC-01 | DEEPSEEK_API_KEY 已配置 | `dsh headless "run the tests"` | 退出 0；末段打印最终答案；会话已持久化 |
| ST-S02-02 | 缺凭证启动即败 | S02-AC-02 | 无凭证 | `dsh headless "task"` | 启动阶段报缺少凭证；非 0 退出；不挂起 |

## S03: ACP 编辑器/自动化后端会话

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S03-01 | initialize→prompt→完成 | S03 主路径 | ACP 客户端 | initialize → createSession → prompt → 等通知 | 语义更新与最终消息到达；关闭连接干净退出 |
| ST-S03-02 | 取消状态推送 | S03 异常 | 会话运行中 | prompt → cancel | 服务端推送 cancelled 状态并停止执行 |

## S04: 为 profile 安装/移除插件

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S04-01 | add 安装并记录 bundle 层 | S04 主路径 | profile 目录可写 | `dsh plugin --profile web add <pkg>` | pnpm 安装成功；导出 `dsh.bundle` 的包被记录；重启后生效 |
| ST-S04-02 | remove 移除插件 | S04 异常 | 插件已装 | `dsh plugin --profile web remove <pkg>` | 依赖移除；重启后该层不再挂载 |

## S05: 反向代理公开部署 Web UI

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S05-01 | 公网 URL + 受信主机访问 | S05 主路径 | 代理剥前缀并改写 cookie | 浏览器访问 `https://app.example/ui/` | 令牌换 cookie 成功；后续 API 经 trusted-host 校验 |
| ST-S05-02 | 非受信 Host 拒绝 | S05 异常 | `--trusted-host app.example` | Host: evil.example 请求 API | 请求被拒 |

## S06: Python 程序嵌入 DSH 完成任务

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S06-01 | 嵌入运行 | S06-AC-01 | wheel 已装、平台 runtime 匹配 | `with DeepSeekHarness(...) as h: h.run(task)` | 返回 final_response；退出时子进程关闭 |
| ST-S06-02 | 平台 runtime 缺失 | S06-AC-02 | 无对应预编译包 | 首次 run | 抛带安装指引的明确异常，不静默降级 |

## S07: TypeScript 程序驱动 DSH 运行时

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S07-01 | 版本一致驱动会话 | S07-AC-01 | 同版本 | initialize → createSession → prompt → shutdown | 收到最终消息；进程干净退出 |
| ST-S07-02 | 主版本不匹配 | S07-AC-02 | 版本不一致 | 建立连接 | 连接阶段报错提示对齐 |

## S08: Desktop 首次启动与后台保持运行

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-01 | 首启到工作区 | S08 主路径 | 全新安装 | 启动应用 | Welcome/API-key 页 → 保存后进入工作区 |
| ST-S08-02 [manual] | 关窗询问后台运行 | S08 主路径 | 有任务运行 | 点关闭 | 原生确认框；确认后隐藏，Dock/托盘可恢复 |

## S09: 复用 Claude Code hooks.json 钩子策略

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-01 | PreToolUse 阻止生效 | S09 主路径 | 挂载 dsh-hooks-claude-code | 触发被钩子声明阻止的工具调用 | 调用被阻止，钩子 stdout 指令被应用 |
| ST-S09-02 | UserPromptSubmit 注入上下文 | S09 主路径 | 同上 | 提交 prompt | 钩子提供的上下文进入会话 |

## S10: 复用 Codex hooks.json 钩子策略

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S10-01 | command 钩子串行执行 | S10 主路径 | 挂载 dsh-hooks-codex | 触发 Stop 事件 | 钩子按序执行；失败被记录不影响代理 |
| ST-S10-02 | 不支持的钩型被跳过 | S10 异常 | 配置含非 command 钩 | 启动 | 仅同步 command 钩运行，其余跳过 |

## 覆盖度校验

- [x] S01–S02 P0 验收条件：正常+异常均 ≥1 用例
- [x] S03–S10 P1/P2 场景：主路径 + 异常路径各 ≥1 用例
- [x] API required 字段 / DB 约束：模块声明 skip_phases（无 API/DB 设计），不适用

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S01-AC-01 | 正常：本地完整启动 | ST-S01-01 |
| S01-AC-02 | 异常：端口占用 | ST-S01-03 |
| S01-AC-03 | 异常：SSH 远程启动 | ST-S01-02 [manual] |
| S02-AC-01 | 正常：任务完成 | ST-S02-01 |
| S02-AC-02 | 异常：缺少凭证 | ST-S02-02 |
| S06-AC-01 | 正常：嵌入运行 | ST-S06-01 |
| S06-AC-02 | 异常：runtime 缺失 | ST-S06-02 |
| S07-AC-01 | 正常：会话驱动 | ST-S07-01 |
| S07-AC-02 | 异常：版本不匹配 | ST-S07-02 |

# ACP-over-network 系统架构

> 变更：20261020-1643-acp-over-network

## 组件表

| 组件 | 包/位置 | 职责 |
|------|---------|------|
| `AcpBridge` | `packages/acp/acp/src/bridge.ts` | 一个 JSON-RPC 连接上的 ACP 语义桥：处理 `initialize`/`authenticate`、session 生命周期、prompt 编排、更新与权限请求投递。 |
| `AcpPlugin` (stdio) | `packages/acp/acp/src/index.ts` | 在进程 stdio 上实例化单个 `AcpBridge`；保留本地/CI 形态。 |
| `AcpNetworkPlugin` | `packages/acp/acp-network/src/index.ts` | 在 Cordis `ctx.webServer` 上注册 WebSocket upgrade route 与 Streamable HTTP route；每个 accepted connection 创建隔离的 `AcpBridge`。 |
| `AcpServer` | `@agentclientprotocol/sdk/experimental/server` | ACP SDK 实验性 server：管理 WebSocket/HTTP 传输、连接注册、initialize 握手。 |
| `dsh-host-webserver` | `packages/host/webserver` | Cordis webserver seam：提供 `registerUpgrade()` / `register()` 接口。 |
| `acp-network-app` bundle | `packages/bundle/acp-network-app` | `dsh --profile acp-network` 启动入口，组合 base + webserver + acp-network。 |
| Token 签发方 | 部署侧/编排器 | 使用共享 secret 签发短期 HMAC token（`sub`/`jti`/`exp`/`aud`）。 |

## 连接时序：首次连接

```text
Client                          dsh-acp-network                AcpServer            AcpBridge
  |                                     |                         |                    |
  |--- WebSocket upgrade /acp --------->|                         |                    |
  |                                     |--- prepareWebSocketUpgrade()               |
  |<-- 101 + Acp-Connection-Id ---------|                         |                    |
  |                                     |--- handleWebSocketConnection()              |
  |                                     |                         |--- connect(stream) |
  |--- initialize -------------------->|                         |                    |
  |                                     |                         |--- initialize()    |
  |<-- initialize response -------------|                         |                    |
  |--- authenticate(token) ------------>|                         |                    |
  |                                     |                         |--- authenticate()  |
  |<-- authenticate response -----------|                         |                    |
  |--- session/new -------------------->|                         |                    |
  |                                     |                         |--- newSession()    |
  |<-- session/new response ------------|                         |                    |
  |--- session/prompt ----------------->|                         |                    |
  |<-- session/update (text chunks) ----|                         |                    |
  |<-- session/prompt response ---------|                         |                    |
```

## 连接时序：断连重连（通过持久化 resume）

```text
Client                          dsh-acp-network                AcpBridge/SessionPersistence
  |                                     |                                  |
  |=== 连接断开 ========================|                                  |
  |                                     |--- AcpBridge.dispose()            |
  |                                     |--- AcpSession.close()             |
  |                                     |--- flush session log               |
  |                                     |                                  |
  |=== 新连接 ==========================|                                  |
  |--- WebSocket upgrade /acp --------->|                                  |
  |--- initialize -------------------->|                                  |
  |--- authenticate(token) ------------>|                                  |
  |--- session/resume {sessionId} ---->|                                  |
  |                                     |--- persistence.stat(sessionId)    |
  |                                     |--- AcpSession.resume()            |
  |<-- session/resume response ---------|                                  |
```

> 当前实现：每个 connection 拥有独立的 `AcpBridge` 实例，connection 关闭会关闭该 bridge 拥有的 session；client 必须通过 `session/close` 显式关闭并持久化会话，或在新连接上通过 `session/resume` 恢复已持久化的会话。后续可增强为 server 级共享 session registry，实现 connection 断开而内存 session 保持。

## 权限确认回环

ACP `session/request_permission` 是 server→client 请求，经 WebSocket 双向帧送达：

```text
AcpBridge ---notify--> clientConn ---transport--> Client
   ^                                              |
   |--------------- response ----------------------|
```

## 安全模型

### 凭证格式

网络形态启用时，`authenticate` 方法校验由部署侧签发的短期 HMAC token：

- 格式：`<base64url-header>.<base64url-payload>.<base64url-signature>`
- Header：`{ alg: "HS256", typ: "JWT" }`
- Payload：`{ sub, jti, exp, aud }`
  - `sub`：token 归属主体，需匹配实例的 `DSH_FLEET_USER_ID`。
  - `jti`：唯一 token id，用于防重放。
  - `exp`：Unix 秒级过期时间。
  - `aud`：受众，需匹配实例受众（默认 `DSH_ACP_NETWORK_AUDIENCE ?? HOSTNAME ?? 'dsh-acp'`）。

### 签发与轮换

- 共享 secret 通过环境变量或 K8s secret 注入 `dsh-acp-network`。
- 部署侧负责签发、轮换 secret；token 有效期默认 5 分钟。
- 进程内只维护短期已用 `jti` 集合，不持久化黑名单。

### 授权边界

- token 仅授权"在此实例上创建/恢复属于该 subject 的 session"。
- `session/list` 受限于同一进程可见的持久化会话；多用户隔离通过"每用户一个 dsh 逻辑实例"保证。
- MCP/工具调用的业务权限由工具层自身凭证进一步约束。

### 防重放

- 每个 token 的 `jti` 在有效期内仅可使用一次。
- 已用 `jti` 集合驻留内存，进程重启后自然清空；依赖 `exp` 限制重放窗口。

### TLS 与网络访问面

- 进程内 webserver 默认监听 loopback（`127.0.0.1`），由 K8s Service/NetworkPolicy 收敛访问面。
- TLS 由 ingress/LoadBalancer 或 Pod 内 sidecar 终结；进程内 WebSocket 为明文。
- 建议通过 NetworkPolicy 限制仅 dspm chat relay 或指定服务可访问 `/acp`。

## 与 ACP SDK 的集成点

- `AcpServer.prepareWebSocketUpgrade()` 在 `101` 响应中附加 `Acp-Connection-Id` header。
- `dsh-host-webserver` 的 `registerUpgrade()` 将 HTTP upgrade 事件路由到插件 handler，避免与 webserver 自身的 `upgrade` 监听冲突。
- HTTP fallback 使用 `createNodeHttpHandler(acpServer)` 并注册到 `ctx.webServer.register({ kind: 'exact', path, handler })`。

## 动态模型目录与错误传播（S48）

网络 ACP 与 stdio ACP 共用 `AcpBridge` 的模型控制实现，因此动态目录不需要新增网络路由、ACP 方法或 dspm 侧协议复制。`session/new`、`session/resume` 和 `session/set_config_option` 在既有响应中携带由 `llm.listModels` 构建的 `configOptions`；目录错误经既有 JSON-RPC error 返回。

```text
Client                         AcpBridge / ModelControl              DeepSeek route
  │ session/new|resume|set_config_option        │                         │
  │────────────────────────────────────────────▶│ listModels(signal)      │
  │                                             │────────────────────────▶│
  │                                             │                         │ cache / GET models
  │                                             │◀── exact catalog/error ─│
  │◀── configOptions or JSON-RPC error ─────────│                         │
```

- 任一必需 provider 目录失败不得被转换为正常空组；新建或恢复会话在 options 构建失败时沿用既有回滚。
- 成功空目录保持 `options: []`；未列出的当前模型只可作为 `currentValue` 描述历史状态，不进入 choices/options，设置校验使用同一份目录。
- 客户端取消只取消自己的目录等待；并发客户端可共享底层发现，最后一个等待者取消才中止共享传输。连接或 bridge 释放不得留下可重新发布结果的发现任务。
- 既有网络认证、连接隔离和会话持久化机制不变；API key 仍只由 DeepSeek 路由的 credentials-first 路径解析，不经过 ACP 网络报文或 dspm 配置复制。

## 会话审批策略配置面（S49）

网络 ACP 与 stdio ACP 共用 `AcpBridge` 的配置入口，因此审批策略配置不需要新增网络路由、ACP 方法或 dspm 侧协议复制。`session/set_config_option` 新增 `permission_policy`（`ask`/`never`/`always`）与 `permission_preset`（permission-presets 预设目录）两个 option id；`session/new` 与 `session/resume` 的 `configOptions` 广告当前值与预设可选目录。

```text
Client                         AcpBridge.setSessionConfigOption      ApprovalService / Presets
  │ set_config_option(permission_policy|permission_preset)
  │──────────────────────────────────────────▶│
  │                                           │ 校验词表/预设目录（未知值 → invalid params）
  │                                           │── setPolicy / preset set() ──▶
  │                                           │◀── approval/policy 事件 + 切换通知 ──
  │◀── 设置回执 + configOptions 当前值 ────────│
  │                                           │
  │◀── session/request_permission（策略触发时，既有回环）──▶│
  │─── allow-once / reject-once ─────────────▶│ 一次性应答结算
```

- 策略与预设状态经既有 `approval/policy` 会话事件持久化，resume 经既有投影折叠恢复；`always` 新枚举值按 required-on-read 语义完成读兼容评估。
- `always` 档下每次工具调用在执行前发起 `session/request_permission`；发起前沿用既有 drainUpdates 顺序，客户端先收到该 turn 之前的全部更新。
- 未实现 `session/request_permission` 的客户端沿用 fail-closed：该次调用被拒，会话不中断，不降级放行。
- 既有网络认证、连接隔离和会话持久化机制不变；审批策略是会话级状态，不引入跨用户或跨实例的新授权面，token 授权边界不变。

## 会话技能清单方法面（S50）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，技能枚举以 bridge 扩展方法注册，因此不需要新增网络路由或 dspm 侧协议复制；ACP 1.4.0 无技能标准面，`session/skills_list` 是 dsh 扩展方法（文档明示扩展属性）。

```text
│ ACP client (dspm)                           │ ACP server (bridge)                    │
│ session/skills_list { sessionId } ────────▶ │ 会话归属校验 → 解析注册表 → 枚举        │
│ ◀──────── { skills: [{name, description,    │ （live agent 预设作用域 → 全局回退，    │
│            modelInvocable, userInvocable}] }│  cwd 取会话 header，不过滤双旗标）      │
```

- 未知会话：invalid params 类 JSON-RPC 错误（与既有 requireSession 姿态一致）。
- 技能注册表未组装：internal error 类错误并说明缺装配，fail-loud，不返回空列表。
- 方法只读、按需拉取：不落会话事件、不在 bridge 缓存快照；每次调用经注册表自身缓存即时发现，清单随目录状态即时。
- 双旗标语义：`modelInvocable=false` 为手势专属（`disable-model-invocation`），`userInvocable=false` 为模型专属；dspm UI 据此区分入口，服务端不做过滤。
- 既有 `session/request_permission` 回环、configOptions 面与 prompt/resume 行为不受影响；`skills/change` 实时推送为后续增量。

## 计划模式方法面（S51）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，计划模式走 ACP 1.4.0 标准面（`session/set_mode` + `modes` 广告 + `current_mode_update`），不需要新增网络路由、扩展方法或 dspm 侧协议复制。

```text
│ ACP client (dspm)                           │ ACP server (bridge)                        │
│ session/new|resume ────────────────────────▶ │ 响应含 modes { currentModeId,              │
│ ◀──────── { modes: {currentModeId,          │  availableModes: [plan, normal] }（插件缺席 │
│            availableModes }] }              │  省略字段）                                │
│ session/set_mode { sessionId, modeId } ────▶ │ 词表校验 → PlanModeController.set          │
│ ◀──────── {} （不承诺生效）                  │  （committed/queued/cancelled/noop）       │
│ ◀─ session/update: current_mode_update ──── │ plan/mode 事件提交时派发（唯一生效事实）    │
│ ◀─ session/request_permission ───────────── │ exit_plan_mode 评审：approve/keep-planning │
│ ◀──────── outcome ────────────────────────  │ （approve 映射批准，其余映射继续规划）      │
```

- 词表与错误：modeId 仅接受 `plan` / `normal`（未知值 invalid params 并给出词表）；未知会话 invalid params；会话关闭中 invalid params；plan-mode 插件缺席 internal error（fail-loud，`modes` 整体省略）。
- 时序：回合间切换立即提交并紧随更新；回合中切换响应先行、更新随下一个 accepted pre-step 到达；noop 与 cancelled 无更新；resume 广告已提交状态。
- plan-review 复用既有 `session/request_permission` 回环与 TLS/鉴权面：新增 optionId 词表 `approve` / `keep-planning`（kind 映射 allow_once / reject_once），评审卡片在工具调用卡片之后到达（drainUpdates 排序）；评审之外的问题保持无应答者语义（REQ-D6 范围）。
goal 完成授权（S54）：bridge 为 owned session 截获 `goal-review` 意图的 userQuestions 请求，经既有 `session/request_permission` 呈现 Authorize/Deny 选项词汇并映射应答（与 plan-review 同构的第二意图应答者）。协议方法零新增；客户端视角是一次普通权限卡片（选项标签指名语义）。Authorize 的回传不经协议面——goal 工具在宿端把应答转换为 witnessed 用户消息后由模型重调完成工具，外部调用仍无法授予完成。
- 既有 configOptions 面、prompt/resume、审批策略与技能枚举行为不受影响；`modes` 为新增可选字段，旧客户端按可选字段容忍。

## 会话压缩方法面（S52）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，压缩以 bridge 扩展方法注册，通知经既有 `session/update` 通道按 client capability 门控派发，不需要新增网络路由或 dspm 侧协议复制。

```text
│ ACP client (dspm)                           │ ACP server (bridge)                        │
│ initialize（clientCapabilities.session.     │ 捕获能力声明（决定 compaction_update        │
│   compaction: {}）────────────────────────▶ │  派发开关）                                │
│ session/compact { sessionId } ────────────▶ │ 归属校验 → 自铸 CommandId →                │
│                                             │ compactNow（空闲相位，FIFO 排队新 prompt） │
│ ◀──────── { result: {compactionId,          │ 成功：统计 + 摘要块；null：无可压缩历史     │
│            summarySeq, shadowedCount,       │                                            │
│            shadowedTokenCount, summary] }   │                                            │
│ ◀──────── error { data.code: busy|... }     │ 六失败码经 data.code + /compact 人类文本   │
│ ◀─ session/update: compaction_update ────── │ compaction/start|end 持久事件派生          │
│    （in_progress / completed / failed）     │ （仅声明 compaction 能力的客户端）          │
```

- 错误词表：`busy`（已有压缩或代理非空闲）/ `cancelled`（caller 取消或会话收尾中断）/ `changed`（选择段变化，尝试留痕）/ `summary`（摘要不可用）/ `commit`（提交未干净完成）/ `persistence`（完成但未保存）——经 internal error `data.code` 携带，message 复用 `/compact` 人类文本；未知会话与空参 invalid params；服务缺席 internal error（fail-loud）。
- 通知派发：仅 `clientCapabilities.session.compaction` 声明者收到；由持久事件派生（start → in_progress、end 无错 → completed 含前置 summary 事件块、end 带错 → failed 含错误文本），bridge 不合成；`cancelled` 与 `compaction_summary_chunk` 不经通知表达。
- 压缩期间新 prompt FIFO 排队并在维护结算后启动（引擎既有语义）；压缩是持久事务，失败尝试留痕日志。
- 既有 `session/request_permission` 回环、configOptions 面、prompt/resume、审批策略、技能枚举与计划模式行为不受影响。

## 默认路由选择与多路由广告语义（S53）

本变更对网络 ACP 协议面零改动；本节补记模型选择面与多路由供给的关系，供部署方对照。

```text
│ 部署 patch（组合配置）              │ llm-pi-ai                       │ acp-network / bridge              │ ACP client (dspm)
│ providers 数组节（路由 A/B）──────▶ │ 归一化 → 注册路由 A/B            │ session/new：provider/model 值对  │
│ provider/model 值对（默认路由）───▶ │（acp-network Config 原样透传）   │ 选定会话起点路由                  │ ◀── configOptions 按供应商分组广告 A/B
│                                    │                                 │ set_config_option 切换 ────────── │ ◀── EpochHeader 持久，resume 恢复
```

- `provider` / `model` 值对语义：会话起点的默认路由选择，不是能力边界——协议面把全部已注册路由按供应商分组广告为 `set_config_option` 模型选项，选择经 EpochHeader 持久、resume 恢复。
- 多路由供给经 llm-pi-ai 配置面完成（数组或 dict），对网络面透明：bridge 与 model-control 只消费 llm 注册表，不需要新增装配、路由或协议帧。
- 值对指向未注册路由时会话创建 fail-loud（既有行为）。
- dspm 部署指引：profile patch 增加 llm-pi-ai `providers` 节（数组或 dict，各自 apiKeyEnv / baseURL），保留 acp-network 行的 `provider` / `model` 值对为默认路由；apiKeyEnv 引用的凭据经凭据存储或环境供给（既有每请求解析，键不入配置）。

## 会话导出方法面（S55）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，导出以 bridge 扩展方法三件套承载——拉式分块读取，无通知流、无 capability 要求，两条传输面零差异。

```text
│ ACP client (dspm)                           │ ACP server (bridge)                        │
│ session/export_begin { sessionId,           │ 归属校验 → flush 活日志 → 预读根日志       │
│   includeDescendants? } ─────────────────▶  │ （缺失 → data.code not_found，零字节应答） │
│ ◀──────── { result: { exportId, filename } }│ per-connection 游标：reader + abort        │
│ session/export_read { exportId } ─────────▶ │ reader.read() → 聚合 ≤ chunkBytes → base64 │
│ ◀──────── { result: { data, eof } }  ×N     │ ResponseCapacityGate 门控；eof 即删游标    │
│ session/export_cancel { exportId } ───────▶ │ abort（zip.terminate）→ 游标即删           │
│ ◀──────── { result: {} }                    │ 连接 quiesce → 全部游标 abort + 清空       │
```

- wire 契约：三方法 params/response 如上；`data` 为 canonical base64（每 read ≤ `exportChunkBytes` 原始字节，默认 256 KiB，base64 膨胀 4/3）；`eof: true` 为终态交付（`data` 可空），其后游标失效。
- 错误词表（`data.code`，消息净化不回显主机路径）：`not_found`（根日志缺失）/ `export_failed`（流中失败，如血缘后代缺失）/ `unknown_cursor`（未知或已终结游标，read 与 cancel 一致）；未知 sessionId invalid params、服务缺席 internal error（S52 同构 fail-loud）。
- 生命周期：终态恰四个（eof 交付 / 流中失败 / 显式 cancel / 连接 quiesce），终态即删、无 TTL；同一会话并发多快照合法（独立时间点快照，begin 时刻语义）；`session/close` 不中止在途导出（快照自洽）。
- 安全可见性：连接级 owned-session 为授权边界；交付完整原始会话日志 + 附件字节（严格多于投影 wire 视图）——与浏览器用户经 `/api/session.export`（browser-auth）同级信任、同工件；规格与升级指南显式声明，无脱敏选项。
- 既有方法面（prompt/resume、configOptions、审批策略、技能枚举、计划模式、压缩、goal 授权卡）与 `session/request_permission` 回环不受第三组扩展方法注册影响；部署旋钮为 dsh-acp Config `exportChunkBytes`（16384–4194304，越界加载失败）与 `exportCompressionLevel`（0–9）。
- dspm 部署指引：无 capability 声明，普通请求序列即可（begin → read × N → eof；中止用 cancel）；消费形态 = 字节流写文件 + 标准 unzip（布局与 web 下载一致）；导出含内部事件与 subagent 日志，镜像侧按完整归档对待；未部署导出方法的服务器返回 methodNotFound，客户端可据 capability-free 探测降级到自建镜像。

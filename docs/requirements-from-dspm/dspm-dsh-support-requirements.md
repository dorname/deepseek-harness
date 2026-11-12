# dspm → dsh 能力支持需求清单

- 提出方：dspm（AI 数据安全平台）agent 集成侧
- 日期：2026-11-05
- 调研基线：deepseek-harness 工作区 HEAD `fb8b38fa68`（产物 v0.2.1-alpha.1，与 dspm 运行时镜像一致）；全部结论来自**只读**代码盘点（三路并行）+ 真机实测，未修改本仓库任何文件
- 关联文档：本目录 `dspm-agent-platform-design.md`；dspm 侧 `REQ-dsh-multi-provider-config` / `DES-dsh-multi-provider-config`（grp-20261104165258）
- 性质：跨团队需求输入，供 dsh 侧评估排期；每项均给出 dspm 现行兜底，未支持不阻塞 dspm 交付

## 0. 背景与集成现状

dspm 经 ACP 集成 dsh：k8s 模式每用户一实例（acp-network profile，websocket + HMAC token，home PVC 持久），已消费能力：

- 动态模型目录发现（v0.2.1-alpha.1 交付，dspm 侧全链路已验收）
- ACP 8 方法子集：initialize / authenticate / session_new / list / resume / close / set_config_option / prompt（+ cancel 通知）
- resume 响应携带 configOptions（目录快照重建）
- 会话 MCP 工具挂载（dsh pod 回连 dspm `/mcp`）

dspm 正在立项「多供应商页面配置 + 会话富能力对齐 dsh web」。本文档 = 调研结论 → 请 dsh 支持清单 + dspm 自建声明（避免双方重复投入）。

## 1. 已验证结论（无需 dsh 改动，供对齐认知）

1. **技能 prompt 级触发是一等通道，真机已验证**（§5）：技能文件置于 `$DSH_HOME/.dsh/skills`（PVC）即被注册表发现（chokidar 自动刷新）；ACP prompt（落库 `source.kind='user'`，`packages/acp/acp/src/session.ts:291-294`）中空白边界的 `/skill-name` 手势由宿端 pre-step 确定性注入技能全文（`packages/skill/tool-skill/src/index.ts:177-204,409,418-431`）；自然语言点名时模型经 `skill({name})` 工具自取（`:81-161`）。
2. **`session/request_permission` 回调通道存在且 fail-closed**：唯一调用点 `packages/acp/acp/src/bridge.ts:414`（ApprovalService waterfall answerer，`:399-419`）；客户端未实现时 SDK 回 `-32601` → 归一化 `'unavailable'` → **拒绝该次工具调用**（`packages/interaction/user-approval/src/index.ts:291`、`packages/core/tools/src/index.ts:1762-1765`），会话与回合不中断，不降级放行。dspm 已按此设计 relay 侧回调实现（fail-closed 兜底与本仓默认拒绝语义一致）。
3. **`set_config_option` 的 model 值已带供应商维度**：choices 按 `llm.listProviders()` 分组，value = `JSON.stringify([provider, model])`（`packages/acp/acp/src/model-control.ts:222-224`；smoke `scripts/smoke-deepseek-discovery.ts:189,208`）——协议面天然支持跨供应商选择（受限于 §REQ-D3 的配置面）。
4. **bridge 不读 clientCapabilities**：initialize 处理器忽略入参（`bridge.ts:186`），fs/terminal 声明不影响行为——dspm 侧声明与实际能力解耦，无协商收益也无副作用。

## 2. 支持需求清单

### REQ-D1（P0）ACP 权限策略配置入口（会话级 / 类别级 ask）

- **现状**：`ApprovalService` 策略仅 `'ask'`（默认）/`'never'`（`packages/interaction/user-approval/src/index.ts:151-153`）；会话级覆盖事件 `approval/policy` 存在（`:100-105`）但**无任何 ACP 入口**；`kind:'ask'` 的触发源全仓仅三处——PreToolUse hook 返回 ask、experimental auto-review、sandbox 显式升权（`sandbox_permissions`）。**默认配置下普通文件写/网络/终端调用均不询问**。
- **缺口**：外部 ACP 客户端无法令 agent 按类别发起询问、也无法调整会话策略。dspm 已设计三分支交互审批（自动批准 / 拒绝不安全 / SSE 审批卡片 + REST 应答、超时拒绝），通道与 fail-closed 语义已对齐（§1.2），但默认配置下回调几乎不会被触发，审批能力形同虚设。
- **请求**（形态任一，d）为兜底）：
  a. `session/set_config_option` 扩展 option id：`permission_policy`（如 `ask-all` / `ask-writes` / `ask-network` / `never`），应用为会话级 ApprovalService 策略；
  b. 或新 ACP 方法 `session/set_permission_policy`；
  c. 或 profile_patch 可配置的「类别默认 ask」清单（config 级），dspm 经 profile 下发逐用户策略。
- **验收建议**：配置 `ask-writes` 后，agent 文件写触发 `session/request_permission`；客户端 `allow-once`/`reject-once` 应答生效（现选项即此两个，`bridge.ts:409-412`，够用；若后续支持 `allow_always` 请保留一次性选项语义）；`never` 会话不发起。

### REQ-D2（P0）技能列表经 ACP 可枚举

- **现状**：`skills/list` Typert Remote（session-addressed，仅返回 userInvocable）走 dsh 自有 connection 协议（`packages/api/session-controller/src/skill-catalog.ts:19-105`）；ACP 面无任何 skill 方法（`bridge.ts:383-394`，grep 零命中）。
- **dspm 兜底（已真机验证）**：自扫 `$DSH_HOME/.dsh/skills` 约定目录列出 name/description。
- **请求**：ACP 会话面暴露技能枚举——如 `session/new`/`session/resume` 响应附 skills 列表，或新方法 `session/skills_list`；字段建议含 `name / description / userInvocable / modelInvocable`（`disable-model-invocation` 技能只能经手势触发，`packages/skill/tool-skill/src/index.ts:138-147`，dspm UI 需据此区分入口）。
- **收益**：技能发现规则（六个根目录/优先级/同名覆盖/frontmatter 校验，`packages/skill/skill-filesystem/src/index.ts:245-265,797-840`）无需 dspm 侧双份维护。

### REQ-D3（P1）acp-network profile 多 provider 配置

- **现状**：acp-network `Config` 仅单 provider/model 单值（`packages/acp/acp-network/src/index.ts:40-66`）；而 §1.3 表明 set_config_option 协议面已支持跨供应商选择——机制在上、配置面只允许一个 provider，实例内跨供应商实际不可达。`providers_set` 方法全仓不存在。
- **请求**：Config 支持 providers 数组（各自 `base_url` / apiKey env 引用 / 默认 model），`llm.listProviders()` 即可返回多组；**无需实现独立 `providers_set`**（set_config_option 已覆盖切换语义）。
- **收益**：单实例可服务多供应商，dspm 可简化「每实例单 provider + 切换重排」的供给链（dspm 方向二按现状设计，此需求落地后作为优化项切换）。

### REQ-D4（P1）上下文压缩（compact）经 ACP 暴露

- **现状**：CompactionEngine 完整交付——手动 `/compact`（`packages/compaction/command-compact/src/index.ts:101-107`）+ 自动触发（压力阈值 / context-overflow 恢复，`compaction-basic/src/index.ts:152-215`）+ LLM 8 段 checkpoint 摘要（`summarizer.ts:118`）+ shadow 替换与 KV 缓存复用；仅 connection 协议可达。
- **dspm 兜底**：「摘要续接」等价实现（模型生成摘要 → 新会话携带 → 原会话归档），UI 不宣称原生压缩；语义不等价（丢失同会话 shadow / 缓存复用 / 自动压力触发）。
- **请求**：ACP 方法（建议 `session/compact`，复用 `compactNow` 失败码 busy/cancelled/changed/summary/commit/persistence，`command-compact/src/index.ts:24-56`）；可选：压缩完成经 `session/update` 通知。
- **收益**：dspm 直接获得原生压缩语义；自动压力触发与 dspm 摘要续接的取舍也可对齐。

### REQ-D5（P1）计划模式经 ACP 暴露，并明示「非强制只读」

- **现状**：PlanModeController 完整——`/plan` 命令（`packages/plan/plan-mode/src/index.ts:230-274`）、log-only `plan/mode` 事件与 resume 恢复、系统提示 section 注入、`exit_plan_mode` 工具 + userQuestions plan-review 审批（`:306-320`）；**README 明确无强制只读**（`packages/plan/plan-mode/README.md`：every tool remains available）。
- **请求**：
  a. ACP 标准方法 `session/set_mode` 在 bridge 注册转发（当前未注册，调用得 `-32601`）；
  b. plan-review 的 userQuestions（Approve / Keep planning）经 ACP 回调转发（形态依赖 REQ-D6 通道）。
- **附注**：如外部场景需要**强制**只读保障，建议 dsh 提供 mode→sandbox/approval 联动配置，而非由 plan mode 承担（其自身不读 sandbox 状态）。
- **dspm 兜底**：prompt 约定模拟（UI 标注模拟模式，已如实声明非原生语义）。

### REQ-D6（P2）userQuestions 交互通道整体 ACP 化

- **现状**：goal complete 人类授权（`packages/goal/tool-goal` completionAuthority）、plan review 等均走 userQuestions intent 通道；ACP 无对应转发。
- **请求**：定义 ACP 上的 user-question 回调（问题文本/选项/超时/取消语义），供上述各需求统一复用。dspm 侧已有 SSE 审批卡片 + REST 应答基建（为本组权限交互设计），可直接承接。

### REQ-D7（P2）文件通道 ACP 化（备选自足方案已落地）

- **现状**：`/api/session.uploadFileBinary` + staged receipt + prompt `{type:'file'}` + 附件只读存储，agent 以文件工具按 host 路径按需读取（字节不进 provider 请求，`packages/llm/llm/src/content.ts:150,178`）——仅私有协议可达。
- **dspm 兜底（架构同构，已按此设计）**：dspm 存储 + prompt 上下文引用 + 会话 MCP 工具 `conversation_attachment_read(attachment_id)`（字节同样不进请求，agent 工具读取）。
- **请求（可选）**：ACP prompt content parts 支持 file 引用 + 配套上传通道（token 鉴权）。若实现成本高，**维持 dspm MCP 方案即可，不阻塞**。

### REQ-D8（P2）会话导出经 ACP 或开放服务间鉴权

- **现状**：`/api/session.export` fetch 路由（ZIP：会话日志 JSONL + 子代理日志 + 附件引用，`packages/session-query/session-log-export/src/archive.ts:347`），browser-auth 鉴权，仅私有协议可达。
- **dspm 兜底**：消息镜像自建导出（Markdown/ZIP）。
- **请求**：ACP 方法触发导出（返回流或文件引用），或该路由支持 dspm 服务间 token 鉴权。优先级低：dspm 镜像版已覆盖主要诉求。

### REQ-D9（P2）目标（goal）经 ACP 暴露（可选，dspm 已自建等价）

- **现状**：goals RPC 全套（get/edit/pause/resume/complete/clear/create，CAS `ref{id,revision}` 乐观并发，`packages/goal/goal/src/index.ts`）+ 模型工具 `get_goal`/`create_goal`/`update_goal`（complete 需人类授权）+ goal-round-driver `<goal_round>` 注入——仅私有协议可达。
- **dspm 兜底**：dspm 存储会话目标 + 每回合 prompt 注入（无 round 推进与 complete 授权语义）。
- **请求**：goals RPC 经 ACP 转发（依赖 REQ-D6），或与 dshm 确认 dspm 侧等价实现为认可形态。若 dsh 侧认为 goal 属私有体验不愿外暴露，dspm 维持自建即可。

## 3. 非请求项与边界声明

- **dspm 不逆向 dsh 私有 connection 协议**（fetch registry / Typert RPC / browser-auth / staged-receipt 均按公开行为对待，不实现其客户端）。
- **`terminal_*` 回调**：dspm 侧维持声明不支持，无请求。
- **dspm 已自建、无需 dsh 重复提供的**：附件（MCP 工具方案）、导出（镜像版）、目标存储与注入、反馈存证（dsh feedback 为 log-only 不影响模型，dspm 存储已覆盖同等诉求）、压缩摘要续接（REQ-D4 落地后切换原生）。
- **`providers_set` 独立方法不请求**（REQ-D3 落地后 set_config_option 已覆盖）。
- dsh 升级指南继续提前同步 dspm（v0.2.1-alpha.1 先例顺畅，保持）。

## 4. 优先级汇总

| 编号 | 需求 | 优先级 | dspm 现行兜底 |
| --- | --- | --- | --- |
| REQ-D1 | 权限策略 ACP 配置入口 | **P0** | fail-closed 通道已对齐，但默认无 ask 触发源 |
| REQ-D2 | 技能列表 ACP 枚举 | **P0** | 自扫 `$DSH_HOME/.dsh/skills`（已真机验证） |
| REQ-D3 | acp-network 多 provider 配置 | P1 | 每实例单 provider + 切换重排 |
| REQ-D4 | 压缩经 ACP 暴露 | P1 | 摘要续接（等价实现） |
| REQ-D5 | 计划模式经 ACP 暴露 | P1 | prompt 约定模拟 |
| REQ-D6 | userQuestions 通道 ACP 化 | P2 | SSE 卡片基建可承接 |
| REQ-D7 | 文件通道 ACP 化 | P2 | MCP 附件工具（架构同构） |
| REQ-D8 | 导出开放 | P2 | 镜像导出 |
| REQ-D9 | goal 经 ACP 暴露 | P2 | 存储 + prompt 注入 |

## 5. 真机验证记录（2026-11-05，dspm 本机 k3s + dsh-acp-network-staging:v0.2.1-alpha.1）

| 步骤 | 操作 | 结果 |
| --- | --- | --- |
| 1 | pod home（PVC `/dsh-home/1`）写入 `.dsh/skills/dspm-live-test/SKILL.md`（frontmatter name+description，正文含标记短语 `DSPM-SKILL-LIVE-OK-1105`） | chokidar 自动发现（无重启） |
| 2 | ACP 会话发送 user 消息：`/dspm-live-test 请原样复述本技能中的标记短语` | 助手回复逐字复述 `DSPM-SKILL-LIVE-OK-1105`，并自述「技能全文已注入」→ **手势触发成立** |
| 3 | 删除备选目录副本（仅保留 `.dsh/skills`），同会话追问 | 模型自述「调用了 `skill` 工具加载成功」，并逐字列出 `<available_skills>` 目录（仅 dspm-live-test 一项）→ **生效根目录 = `$DSH_HOME/.dsh/skills`；目录注入与工具加载均成立** |
| 4 | 验证后清理技能文件 | PVC 恢复原状 |

**权限真机说明**：`request_permission` 通道真机不可独立构造——默认配置无 ask 触发源（§REQ-D1 现状），此点恰为 REQ-D1 的请求动因；通道与 fail-closed 行为以代码证据为准（§1.2），dspm 侧回调实现完成后的集成验收将覆盖端到端分支。

## 6. 调研证据索引（file:line 摘要）

- ACP 方法面：`packages/acp/acp/src/bridge.ts:383-394`（8+1）；request_permission 调用 `:399-419`（answerer）、`:414`（发起）；initialize 忽略 capabilities `:186`
- 审批：`packages/interaction/user-approval/src/index.ts:151-153`（策略词表）、`:100-105`（approval/policy）、`:291`（answerer 异常→unavailable）；`packages/core/tools/src/index.ts:1727-1768`（serviceAsk）、`:611`（ask 类型生产）；fail-closed 文案 `:1762-1765`
- 技能：发现根 `packages/skill/skill-filesystem/src/index.ts:245-265`；frontmatter `:797-840`；手势 `packages/skill/tool-skill/src/index.ts:177-204,409,418-431`；工具 `:81-161`；目录消息 `:213-277`；skills/list `packages/api/session-controller/src/skill-catalog.ts:19-105`
- 压缩：`packages/compaction/command-compact/src/index.ts:59-107`；`compaction-basic/src/index.ts:152-215`（自动触发）；`summarizer.ts:118`
- 计划：`packages/plan/plan-mode/src/index.ts:175,230-274,306-320`；README（非强制只读）
- goal：`packages/goal/goal/src/index.ts`（@Remote 各方法）；`packages/goal/tool-goal/src/index.ts:196-235`
- 反馈：`packages/feedback/command-feedback/src/index.ts:101`；`packages/feedback/message-feedback/src/index.ts:154-206`（log-only）
- 导出：`packages/session-query/session-log-export/src/index.ts:96-107`；`archive.ts:347`
- 文件：`packages/client/file-upload/src/http-route.ts:22-67`；`packages/attachment/attachment/src/index.ts:114`；`packages/llm/llm/src/content.ts:150,178`
- 模型配置面：`packages/acp/acp/src/model-control.ts:8-9,222-224`；`packages/acp/acp-network/src/index.ts:40-66`（单 provider Config）

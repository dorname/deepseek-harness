# dspm → dsh 支持需求评估报告（dsh 侧）

- 日期：2026-11-05
- 评估基线：HEAD `fb8b38fa68`（与需求文档调研基线一致；全部 file:line 以 `src/` 为准）
- 方法：四路并行只读核验（安全边界簇 D1+D5 / 技能压缩簇 D2+D4 / 模型配置面 D3 / P2 簇 D6–D9），每项声明逐条比对代码
- 输入：本目录 `dspm-dsh-support-requirements.md`
- 用途：排期决策 + Phase 2（P0 change proposal）设计输入 + 回复 dspm 的底稿

## 1. 结论总览

| 编号 | 诉求 | 核验结论 | 建议方案 | 规模粗估 | 建议 |
| --- | --- | --- | --- | --- | --- |
| REQ-D1 (P0) | 权限策略 ACP 入口 | 覆盖机制已完成，仅缺入口；但策略词表无「强制询问」档 | 薄入口（policy option + 预设目录 option）+ 新增 `always` 档 | 小-中（3–5 天） | **接受，第一期** |
| REQ-D2 (P0) | 技能列表 ACP 枚举 | 私有协议独占确认；数据源 bridge 可达；字段大半现成 | `session/skills_list` 扩展方法 | 小（2–3 天） | **接受，第一期** |
| REQ-D5 (P1) | 计划模式经 ACP | ACP SDK 1.4.0 已建模，bridge 全未接 | 注册 `set_mode` + `modes` 广告 + plan-review 复用 `request_permission` | 中（3–5 天） | **接受，第二期** |
| REQ-D4 (P1) | 压缩经 ACP | `compactNow` 公开可达；SDK 有 UNSTABLE 通知面 | `session/compact` 扩展方法 + `compaction_update` 通知 | 中（3–5 天） | **接受，第二期**（dspm 需接受 UNSTABLE + capability 广告） |
| REQ-D3 (P1) | 多 provider 配置 | 限制仅 Config 层；下游天然多 provider；**dspm 今天即有零代码路径** | `providers` 数组 + 指定默认路由 | 中（3–5 天） | **接受，第三期（优化项）** |
| REQ-D6 (P2) | userQuestions ACP 化 | 通道成熟，4 消费者先例；goal 授权不在其中（dspm 文档错位） | ACP user-question 回调（扩展方法） | 中（4–6 天） | **接受，按需触发**（不阻塞 P0/P1） |
| REQ-D7 (P2) | 文件通道 ACP 化 | ACP 面仅 text / resource_link（文本化）/ image | 维持 dspm MCP 方案 | — | **婉拒（dspm 自建即认可形态）** |
| REQ-D8 (P2) | 导出开放 | 双路径增量可行；HMAC token 机制可复用 | 二选一，后定 | 小-中（2–4 天） | **延后（P2 末位）** |
| REQ-D9 (P2) | goal 经 ACP | 活 Agent 句柄 seam + 宿端见证授权不可外授 | decline + 文档化「goal 属私有体验」 | — | **婉拒（附理由）** |

规模粗估为代码盘点推导的工程量级（含测试 / 快照 / 升级指南 / 文档），非承诺；排期以 Phase 2 proposal 为准。

## 2. 对需求文档的核验修正（建议回传 dspm 更新原文）

需求文档总体准确（绝大多数声明 CONFIRMED），以下修正影响方案设计或后续集成验收：

1. **ask 触发源精度（§1.2 / REQ-D1）**：`kind:'ask'` 产源实为两处——PreToolUse hook（`hooks/hooks-claude-code/src/index.ts:248`）与 auto-review（`experimental/auto-review/src/index.ts:660`）；sandbox 升权不产 ask，而是经 `approveEscalation` 直通审批 seam（`sandbox/sandbox/src/escalation.ts:188`，bash/pwsh/fs/ptc/plugin_manager 五个工具家族）。操作结论不变：ACP 下 `session/request_permission` 的现实触发源仅 sandbox 升权，普通调用恒放行（pre-execute waterfall 默认 ALLOW，`core/tools/src/index.ts:1507`）——REQ-D1 动因成立。
2. **`ask-network` 无支撑面（REQ-D1，关键）**：sandbox 词表仅文件访问维度，无网络维度；全仓亦无工具类别分类法。「按类别 ask」需发明两个词表，是独立于本清单的较大设计项，v1 不含。
3. **REQ-D2 字段大半现成**：`skills/list` wire 条目已携带 `modelInvocable`（`api/session-controller/src/types.ts:245-256`）；手势专属技能（`disable-model-invocation`）已列于目录且 `modelInvocable:false`；`userInvocable` 因现有过滤器恒 true，作显式字段是平凡新增。
4. **goal 授权通道错位（REQ-D6）**：goal complete 人类授权**不经过** userQuestions——是会话事件见证（开放回合内存在 `source.kind==='user'` 的 user/message，`goal/tool-goal/src/authority.ts:80-93,111-118`）。ACP 问题回调即使落地也不会解锁 goal complete，需另行接线。
5. **REQ-D4 形态细节**：六失败码是 `ManualCompactionError.code` 闭联类型属性（`compaction/compaction/src/index.ts:35-41`），非结果联合；到 ACP 错误语义的映射是设计点。自动压缩今天纯 log-only（`compaction-basic/src/index.ts:150-156,172,213-225`），无任何面向用户的完成通知。
6. **REQ-D3 线引用修正**：单值对在 `acp/acp-network/src/index.ts:55-56`（引用的 40-51 接口块不含，继承自 `AcpBridgeOptions`）；分组在 `acp/acp/src/model-control.ts:160-175`（8-9 是 option-id 常量），value 编码在 `:223-226`。
7. 其余声明（§1.1 手势链路、§1.3 协议面、§1.4 capabilities、REQ-D7 文件字节不进请求、REQ-D8 导出与 browser-auth、REQ-D9 goals RPC、feedback log-only）均与代码一致。

## 3. 分项评估

### REQ-D1 权限策略 ACP 入口 —— 接受，第一期

**现状（核验后）**：`ApprovalService` 覆盖机制完整——程序化 `setPolicy(agent, policy)`（`user-approval/src/index.ts:184-195`，追加事件 + 注入模型可见切换通知）、会话级 `approval/policy` 事件 LAST-wins 折叠（`effectivePolicy` :243-245：override → config 默认 → `'ask'`）、可重放可投影（permission-presets 折入 `permissions` 投影）。全仓唯一调用方是 `/permission` 命令与会话种子。**只缺 ACP 入口。**

**必须向 dspm 讲清的语义**：`'ask'` 是默认**放行**（已产生的 ask 交用户应答），`'never'` 是自动拒绝 ask；两者都不是「强制询问」。dspm 验收场景（配置后文件写触发 `request_permission`）无法由裸开关满足。

**方案（三层递进）**：
1. **薄入口（必做）**：option id `permission_policy`（值 `ask`/`never`）——bridge `setSessionConfigOption`（`bridge.ts:342-354`）先于 modelControl 委托处理，调 `ctx.get('approval').setPolicy(...)`；configOptions 在 new/resume 广告（`:236`、`:292`）。词表与 fail-loud 校验现成（`APPROVAL_POLICIES`，`TypeError`）。
2. **`always` 档（建议同批）**：新增策略值「每次工具调用先询问」——pre-execute 监听将每次调用路由进现有 serviceAsk 管线（`core/tools/src/index.ts:1727-1768`）。这是 dspm 验收的直达路径；小机制，但引入新枚举值，需确认 `approval/policy` 事件读侧对未知值的处理（required-on-read 语义下或需 `ignorable` 评估）。
3. **预设目录 option（低成本增量）**：暴露 permission-presets 现有 catalog（`catalog()`/`set()`，`permission-presets/src/index.ts:292-299,398-400`；read-only / workspace-write / danger-full-access，`PresetSpec` 打包 {sandbox, approval}）。设计期验证：read-only 沙箱下文件写是否经 `approveEscalation` 升权梯（`escalation.ts:28-31` strictly-wider ladder）产生 ask——若是，「ask-writes」语义天然成立。
4. **类别级 ask（原形态 (c)，不在本期）**：需 pre-execute 新监听插件 + 工具类别分类法 + sandbox 网络维度，独立立项。

**`allow_always`**：ACP 协议定义了该选项类型，bridge 今天只发 allow-once / reject-once（`bridge.ts:409-412`）。按 dspm 要求保持一次性语义优先；如支持作独立增量。

### REQ-D2 技能列表 ACP 枚举 —— 接受，第一期

**现状**：`SessionSkillCatalog` Typert Remote（session-addressed，`isUserInvocable` 过滤，`skill-catalog.ts:19-105`）仅经 `/api/remote.mux` WebSocket 可达；ACP 面零技能方法。数据源是宿级分层 SkillRegistry（6 根目录 rank 100–600、同层低 rank 胜 `skill/src/index.ts:567-582`、跨层最近 scope 胜 :551-565、frontmatter 校验 warn+skip `skill-filesystem/src/index.ts:797-840`），每次 list() 派生并按 cwd+scope+revision 缓存。bridge 持有 `ctx` 与每会话完整 `Agent`（`acp/src/session.ts:100`），可达同一注册表。

**方案**：新方法 `session/skills_list`（bridge 扩展方法——ACP 1.4.0 无技能标准面），复用 SessionSkillCatalog 解析逻辑（live agent / standing scope / 全局回退，`skill-catalog.ts:41-104`），字段 `name / description / modelInvocable / userInvocable`（末者显式新增，平凡；description 全文，无截断）。范围决策（Phase 2）：维持 userInvocable 过滤（UI 入口区分由 `modelInvocable` 承担，今天已够）vs 列全部并带双旗。`packages/acp` 新增 dsh-skill peer dep；注册表缺失 fail-loud（对齐 `skill-catalog.ts:66-72` 姿态）。

**否决「响应附挂」形态**：session/new/resume 组装点（`bridge.ts:240`、`:292`）附挂可行，但 (i) 技能发现是惰性的，增加建会话延迟；(ii) 快照会过期。`skills/change` 事件（`skill/src/index.ts:296`）可镜像 topologyChanged → config_option_update 推送模式（`session.ts:212-234`）作为后续增量。按需拉取为主形态。

### REQ-D5 计划模式经 ACP —— 接受，第二期

**现状**：ACP SDK 1.4.0 完整建模（`set_mode` 方法、`SessionModeState`、`CurrentModeUpdate`），bridge 全未接：未注册 set_mode（未知方法 → `-32601`）、new/resume 响应不带 `modes`、onSessionEvent 无 plan/mode 分支。acp-app 建于 dsh-base，plan-mode / user-approval / permission-presets / user-questions 已全部组装（`bundle/base/cordis.patch.yml:246-262,322-336`）——**只缺入口**。现实缺陷：ACP 下今天 `exit_plan_mode` 的 review 死于 `NO_PROVIDER` 工具错误（userQuestions 无 answerer，`user-questions/src/index.ts:318-321`）。

**方案**：
- 注册 `session/set_mode`：`requireSession` + `ctx.get('planMode')?.set(agent, modeId === 'plan')`（planMode 是已声明 Context 服务，`plan-mode/src/index.ts:56-60`）；new/resume 响应补 `modes`（plan / normal 二值）；onSessionEvent 增 `plan/mode` 分支发 `CurrentModeUpdate`。
- **语义明示（协议约束）**：`SetSessionModeResponse` 按 schema 是 `{}`，且回合中切换返回 `queued`（下一 accepted pre-step 生效，`plan-mode:196-213,441-453`）——响应体无法表达 committed/queued 区分，需经 `CurrentModeUpdate` 时序体现或扩展字段，Phase 2 定；对外不宣称立即生效。
- plan-review 转发：`user-questions/request` waterfall answerer 将 `intent.kind==='plan-review'` 的问题映射到现有 `session/request_permission`（Approve / Keep planning → allow_once / reject_once，`cancelled` 处理已有 `bridge.ts:416`）——复用已验证管线，**不依赖 REQ-D6**。此转发同时修复上述 NO_PROVIDER 缺陷。
- 强制只读：按 dspm 附注方向，以「mode→preset 联动配置」承载（permission-presets 即现成形态），不由 plan mode 承担（其不读 sandbox/approval 状态，`plan-mode:176` inject 列表可证）。

### REQ-D4 压缩经 ACP —— 接受，第二期

**现状**：`compactNow` 是 `ctx.compaction` 公开方法（`compaction/src/index.ts:162-166`，实现 `compaction-basic/src/index.ts:383-435`；唯一生产调用方 `/compact` `command-compact:67`）。需 idle Agent（AcpSession 完整 Agent 合格）+ AbortSignal + 可选 branded CommandId。bridge inject 列表缺 compaction（`bridge.ts:61`）——经可选 `ctx.get('compaction')` 暴露，插件未组装时 fail-loud。失败码 `ManualCompactionError.code` 六值闭联（busy/cancelled/changed/summary/commit/persistence）。并发安全：压缩期间会话处于 runMaintenance，后续 prompt FIFO 排队（`compaction/src/index.ts:146-152`），不影响 bridge 单 prompt 槽语义。SDK 1.4.0 **无** `session/compact`，但 session/update 已含 UNSTABLE `compaction_update`（status: in_progress/completed/failed/cancelled）与 `compaction_summary_chunk`，gated on `ClientSessionCapabilities::compaction`。

**方案**：`session/compact` bridge 扩展方法，复制 `/compact` 包装语义（参数守卫 `:63-65`、null → "无可压缩历史" `:68`、成功文本 + `sourceEventSeq` 关联 `:69-73`、caller-abort → cancelled `:75`、六码人话映射 `:24-56`、自有 CommandId 记入 `compaction/start`）。完成通知首选标准 `compaction_update`（dspm 需广告 capability 并接受 UNSTABLE 标记）；不接受则回退扩展通知或纯同步响应。失败码经 JSON-RPC error data 携带。

### REQ-D3 多 provider 配置 —— 接受为优化项；dspm 今天即有零代码路径

**核心事实**：单 provider 限制**仅在 acp-network Config 层**。llm 注册表天然多 provider（adapter map 按路由 id，`llm/src/index.ts:472-475`；`registerAdapter` :391-420 收数组、多 adapter 共存）；**出货的 base bundle 已挂两个 DeepSeek 路由**（deepseek-official、deepseek-account）加休眠的 llm-pi-ai 多 provider 孪生（`bundle/base/cordis.patch.yml:127-128,525-529`）。会话级跨 provider 切换端到端可用：选择经 `request/header` 的 `EpochHeader.config` 持久（`core/session/src/types.ts:240-251`）、resume 恢复（`acp/src/session.ts:154-157`），下游零单 provider 假设。

**dspm 零代码路径（立即可用）**：自组 profile overlay——llm-pi-ai `providers` dict 配多路由（`role('credential-ref')` env 惯例现成，`llm-pi-ai/src/config.ts:92-183,327`）+ acp-network 行设默认对。无需等 dsh 排期，正好替代其「每实例单 provider + 切换重排」供给链。

**dsh 侧优化形态（若做）**：`providers?: Array<{ provider, model? }>`（对齐 agent-loop 数组先例 `core/agent-loop/src/index.ts:292-309`）+ 保留 `provider/model` 为指定默认路由。**默认路由必须有**：picker 仅在会话有初始选择时广告选项（`model-control.ts:107,147-148`），裸数组会把客户端选择器清空。`baseURL`/`apiKeyEnv` **不上**该数组——归属 provider 插件行。消费者清单：acp-network schema（`acp-network/src/index.ts:54-66`）、bridge `AcpConfig`/helpers（image probe `:187`、agentOptions `:493-498`、initialSelection `:500-505`；stdio 孪生共享类型 `acp/src/index.ts:37,61-68`）、两个 bundle patch、tests、README(+zh)、generated config-catalog。**packages/llm、packages/core 零改动**。备注：llm-pi-ai 的 dict 先例明确拒数组（`:414-416` 迁移先例），若 dspm 接受 dict 形态可少一类分叉。

### REQ-D6 userQuestions ACP 化 —— 接受，按需触发

通道成熟：`UserQuestionService`（`ctx.userQuestions`，`interaction/user-questions/src/index.ts:79`），载荷 `{question, detail, header, options, multiSelect, intent}`（`types.ts:38-53`），超时（`askTimed`，默认 120s；超时后 pending/`continued`，迟到应答落 `user-question-reply` 消息）与取消（ASK_ABORTED/ASK_CANCELLED）齐备。消费者先例 4 个：tool-ask-user、plan-mode（`:302-334`）、claude-code-mods `$.ui.ask`（`host-ops.ts:245-246`，非 GUI 先例）、BFF browser answerer。

dspm 判断正确：`request_permission` 一问一选项、无超时/自由文本/批量，SSE 卡片 + REST 应答应映射 userQuestions 而非 request_permission。ACP 回调为 bridge 扩展方法（SDK 的 `elicitation_create` 未被 bridge 使用，可评估复用）。

**关键预期管理**：goal complete 授权是宿端事件见证，不因问题回调解锁（见 §2.4）；且 `continued` 态应答落库为 `user-question-reply`，也不满足见证条件——如未来要打通需新 authority 接线。

### REQ-D7 文件通道 —— 婉拒

ACP 面今天收 text / resource_link（文本化标记，URI 不加载，`acp/src/content.ts:107-109,180-182`）/ image（capability + 模态门控 `:137,157`）；拒绝 audio/resource（`:140-143`）。dspm 的 `conversation_attachment_read` MCP 方案与仓库不变量（provider 请求永不携带文件字节，`llm/src/content.ts:146,178-180`）同构，是低成本且代码库一致的选择。维持 dspm 方案即认可形态。

### REQ-D8 导出 —— 延后

双路径均增量可行：(i) ACP 方法流式 `sessionLogZipEntries`（`archive.ts:347-404`）；(ii) `/api/session.export` 增 acp-network HMAC token admission 分支（`signHmacToken` / timing-safe compare / 300s TTL / subject+jti 防重放齐备，`acp-network/src/index.ts:74,93,134-166`；webhook-ingress 有第二先例）——是**新增分支**非开关（现守卫严格 browser cookie + Host/Origin fence，`rpc-host.ts:107-108`）。dspm 镜像版已覆盖主诉求，P2 末位。

### REQ-D9 goal —— 婉拒（附理由）

两项结构性障碍：(i) GoalService 各方法取活进程内 `Agent` 句柄（`assertLive`，`goal/src/index.ts:329` 等），无 session-id 间接，ACP 转发需新造 id-based seam；(ii) complete 授权是宿端见证模型（direct-human / exact-goal-round，`authority.ts:111-118`），任何客户端调用都无法授予——外部触发的 complete 违反该安全模型。dspm 自建存储 + prompt 注入即认可形态；dsh 文档化「goal 属私有体验」。

## 4. 主题设计决策

1. **标准面优先，扩展方法最小化**：`set_mode` / `request_permission` / `compaction_update` 走 ACP 标准或不稳定标准面；`skills_list` / `compact` / user-question 回调为 bridge 扩展方法（ACP 1.4.0 无对应物），集中注册、文档明示扩展属性。
2. **安全边界能力面（D1+D5 联合）**：会话级审批策略（含 `always` 档）+ 预设目录 + plan mode 暴露构成对外安全控制三件套，全部落在成品 seam 的薄入口上；强制只读以 mode→preset 联动承载，不由 plan mode 承担。
3. **模型可见 ⟺ 已记录**：全部方案无新增模型可见输入（approval/policy 切换通知、plan/mode、compaction 表面替换均已落 session log）——无 `SESSION_FORMAT_VERSION` 影响。唯 `always` 新枚举值需过 required-on-read 评估。
4. **升级指南**：每个 ACP 面变化（新增方法 / option id / 响应字段）按 v0.2.1-alpha.1 先例提前同步 dspm。

## 5. 建议批次

- **第一期（P0）**：D1（permission_policy + `always` 档 + 预设目录 option）、D2（skills_list）
- **第二期（P1）**：D5（set_mode + modes + plan-review 转发）、D4（session/compact + compaction_update）
- **第三期（P1 优化）**：D3（providers 数组）；同步告知 dspm 零代码路径今天可用
- **按需**：D6（user-question 回调）、D8（导出二选一）
- **婉拒**：D7、D9（dspm 自建即认可形态）

## 6. 给 dspm 的回复要点

1. P0 两项接受并排期（形态见 §3）；**类别级 ask（ask-writes / ask-network）v1 不含**——无工具类别分类法、sandbox 无网络维度，独立立项评估；`always` 全量询问档作为验收直达路径同批交付。
2. REQ-D2 字段大半现成（`modelInvocable` 已在 wire 类型、手势专属技能已列出），形态 `session/skills_list` 按需拉取。
3. REQ-D3 零代码路径（llm-pi-ai providers dict + acp-network 默认对 overlay）今天可用，附配置样例；数组形态作为优化项排期。
4. §2 核验修正清单请回传更新其文档——尤其 goal 授权通道错位（REQ-D6）与 `ask-network` 缺口（REQ-D1）。
5. D7 / D9 decline 确认（其自建即认可形态）；D4 需 dspm 确认接受 UNSTABLE `compaction_update` + capability 广告，否则同步响应兜底。
6. 升级指南继续提前同步。

# 合并指令

## 变更提案
- 提案名称：dsh-acp-goal-approval
- 提案目录：logos/changes/dsh-acp-goal-approval/

## 提案内容

# 变更提案：goal 完成授权经 ACP 客户端应答（userQuestions 卡片回传 + 见证保持）

> module: core | created: 2026-11-08

## 变更原因

dspm REQ-D6（userQuestions ACP 化）在回复文档 §4.4 被接受为「按需触发」；§8 决策变更（2026-11-08）将其中 **goal 授权经 ACP 的设计提前排期**，不等首个真实消费者。现状缺口经核验：goal 完成/受阻授权是宿端会话事件见证——根 agent 的**开放模型回合**内存在 `source.kind='user'` 的 `user/message`（`packages/goal/tool-goal/src/authority.ts:80-93` 的 direct-human 见证，`completionAuthority` :111-118 门槛），或恰好是该 goal 的 admitted round。ACP prompt 经 `createUserMessage({source:{kind:'user'}})` + `agent.followup`（`packages/acp/acp/src/session.ts:463-471`）满足 direct-human，但 ACP 的 prompt 是回合边界事件：模型回合进行中，人类唯一的输入通道是 `session/request_permission`（plan-review 先例，S51）；而未经授权的 `complete`/`blocked` 工具调用今日被立即以 `GOAL_TOOL_AUTHORITY_REQUIRED` 拒绝，无任何向人类征求授权的通道——回合结束后人类虽可发新 prompt（新回合内重调工具可获见证），但该路径模型依赖且多一轮往返。

两项结构性障碍的消解（对照回复文档 §5.2）：(i) GoalService 无 id seam（各方法取活 `Agent` 句柄，`packages/goal/goal/src/index.ts:390-400`）——本设计**不需要**该 seam：授权回传不变成外部 complete 调用，而是 steer 回一条 witnessed 用户消息、由模型自己在同一开放回合内重调完成工具，GoalService 零改动；(ii) 「任何客户端调用都无法授予」——本设计保持该安全模型：ACP 应答只是把人类动作转换成见证本就接受的工件（开放回合内 `source.kind='user'` 的 `user/message`），见证逻辑（authority.ts）零改动。

## 变更类型

接口级（userQuestions intent 联合新增 tagged kind——宿主内类型、设计为开放联合）+ 代码级（goal 工具 ask 路径、ACP bridge 第二个意图应答者）；无协议方法面、无持久化面变更。

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的场景总览与核心场景详述；新增 S54，并关联 S49（userQuestions/审批面）、S51（plan-review 先例）。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 新增 §14 goal 完成授权经 ACP 规格。
- 影响的业务场景：新增 S54「goal 完成授权经 ACP 客户端应答」；回归既有 goal round 流、S49 审批策略、S51 计划模式 review、S03 ACP 会话主链路。
- 影响的技术架构：`core-system-map.md`（goal 授权面）与新增 `core-S54-acp-goal-approval.md`；acp-network-system-map 补记 goal 意图应答（协议方法零新增）。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 与 `acp-network-deployment-plan.md` 的发布物、staging 验证与回滚注意。
- 影响的 API：`tool-goal` 的 `complete`/`blocked` 工具在授权缺失且 `ctx.get('userQuestions')` 存在时先经 `interaction.ask()` 征求授权（问题指名 goal 标题与操作，选项 Authorize/Deny，intent `{kind:'goal-review', approve, goalId, callId?}`）；应答 Approve → 工具 `agent.steer()` 回一条源为 user 的用户消息进入开放回合并返回指向重调的结构化结果；Deny/取消/无通道 → 既有权威拒绝保持（无通道时立即失败，行为不变）。`AskUserQuestionIntent` 新增 `goal-review` tagged kind（呈现意图，协议与应答编码不变；未知 kind 的 UI 走通用卡片——联合设计契约既有）。该 intent 为宿主内类型（发起方 plan-mode 同层），不跨 ACP wire——桥接在出线前已转换为 `session/request_permission` 选项，双 SDK 零改动。ACP bridge 在 `user-questions/request` 瀑布上新增 goal-review 意图应答者（owned session 匹配，`session/request_permission` 承载 Authorize/Deny 选项词汇）——`session/request_permission` 方法面零新增。见证模型、`GoalService`、`SessionEventMap`、Session format 零改动。
- 影响的 DB 表：无；零新增会话事件类型（ask 应答循既有 `user-question-reply`，steer 消息即普通 `user/message`），`SessionEventMap` 不变，Session format 维持 4。
- 影响的编排测试：无。
- 影响的测试规格：新增 `logos/resources/test/core-S54-test-cases.md`；更新 `logos/resources/test/smoke/acp-network-smoke-test-cases.md`（SMOKE-acp-network-08）；复用 S49/S51 既有用例与 S03 回归 ID。
- 实现期交付物：`tool-goal`、`user-questions`、`acp` 中英文 README 与 JSDoc 契约更新、keyless recorded-session 快照新场景（固定 steer 消息与工具结果文本）、`docs/upgrade-guide/<发布版本>/acp-goal-approval/` 中英文升级指南条目（版本号随发布期确定）。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费含 goal-review 意图与 goal 工具 ask 行为的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付；其 ACP 客户端需按新意图呈现授权卡片。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物。零新增持久化事件类型，回滚无迁移；旧构建无 ask 行为（未授权完成回到立即拒绝），已写入日志的 steer 消息是普通 `user/message`，旧构建读取无损。
- 是否需要 smoke：是
- smoke 要求：ACP 会话内验证 goal 授权卡片往返——mock 模型驱动未授权 `complete` 调用 → 客户端收 `session/request_permission`（goal 选项词汇）→ 应答 Authorize → steer 消息落回合 → 模型重调完成 → 会话日志含 witnessed 用户消息与完成事件（SMOKE-acp-network-08）。

## 变更概述

1. **授权征求（goal 工具 ask 路径）**：`complete`/`blocked` 在 `completionAuthority` 拒绝时，若 `ctx.get('userQuestions')` 存在则先征求——问题指名 goal（标题/引用）与操作（完成/受阻），选项 Authorize/Deny，intent `{kind:'goal-review', approve:'Authorize', goalId, callId}`。无通道（headless 等非交互组合）行为不变：立即 `GOAL_TOOL_AUTHORITY_REQUIRED`。admitted round 与已有 direct-human 的调用在权威门槛即通过，永不征求。deny 或取消（人类收回落卡改发言）不产生 steer、不产生见证输入，工具返回既有拒绝并注明人类已拒绝。
2. **授权回传（witnessed steer-back）**：Authorize 应答后工具以 `agent.steer()` 注入一条源为 user 的用户消息（文本固定：确认授权该 goal 的该操作并指示模型立即重调完成工具）——steer 目标 'next-step'，消息在工具结果之后、同开放回合内提交，模型可见（模型可见 ⟺ 已记录：普通 `user/message` 事件）；模型重调完成工具时 `completionAuthority` 以 direct-human 通过，完成照常提交。授权流不产生任何外部 `GoalService.complete` 调用——「任何客户端调用都无法授予」的安全模型原样保持，见证条件一字未改。
3. **ACP 承载（bridge 第二意图应答者）**：bridge 在既有 `user-questions/request` 瀑布上为 owned session 截获 `goal-review` 意图（S51 `answerPlanReview` 同构：单问题 + 指名意图 + callId 匹配），经 `session/request_permission` 呈现 Authorize/Deny 选项词汇并映射应答；其余意图保持无应答者行为（全量 userQuestions 通道仍按 §4.4 按需排期）。web 宿主经既有通用卡片流应答同一请求，零宿主改动。零新增协议方法、零新增会话事件、零新增 Config——模型可见 ⟺ 已记录不变量与 Session format 4 均保持。

## 复用测试 ID

- 既有 tool-goal 单元用例与 goal-round-driver 用例 — 回归 admitted round 与 direct-human 既有授权路径不变（权威门槛先于 ask，通过路径永不征求）。
- UT-S49-01..07、ST-S49-01/02 — 回归 userQuestions 服务、审批策略与快照回放不受意图扩展影响。
- UT-S51-01..06、ST-S51-01 — 回归 plan-review 意图应答不受新应答者影响（瀑布 next() 契约）。
- ST-S03-01/02 — 回归 ACP 会话主链路（prompt/resume/configOptions）不受影响。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S54-acp-goal-approval.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/prd/3-technical-plan/2-scenario-implementation/core-S54-acp-goal-approval.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S54-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/test/core-S54-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/smoke/acp-network-smoke-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-goal-approval/deltas/test/smoke/acp-network-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(dsh-acp-goal-approval): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive dsh-acp-goal-approval`。

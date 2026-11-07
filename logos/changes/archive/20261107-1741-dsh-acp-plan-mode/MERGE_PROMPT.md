# 合并指令

## 变更提案
- 提案名称：dsh-acp-plan-mode
- 提案目录：logos/changes/dsh-acp-plan-mode/

## 提案内容

# 变更提案：ACP 计划模式标准面（session/set_mode + modes + plan-review 复用审批通道）

> module: core | created: 2026-11-07

## 变更原因

dspm 经 ACP 集成 dsh，需要在其 UI 上呈现并切换 dsh 的计划模式（先规划、审批后执行），替代其当前的 prompt 约定模拟（UI 标注模拟模式、非原生语义）。dsh 侧 `PlanModeController` 完整交付（`/plan` 命令、log-only `plan/mode` 事件与 resume 恢复、系统提示 section 注入、`exit_plan_mode` 工具 + plan-review 审批），但 ACP 面存在两个缺口：

1. **模式面缺失**：ACP 1.4.0 标准方法 `session/set_mode` 未在 bridge 注册（调用得 JSON-RPC -32601），`session/new` / `session/resume` 响应不携带 `modes`（`SessionModeState`），模式变更也不经 `session/update` 发 `current_mode_update`——dspm 无法感知或切换真实计划模式。
2. **plan-review 无应答者**：`exit_plan_mode` 的计划评审（Approve / Keep planning）走 `user-questions/request` 瀑布，ACP 组合不挂应答者，模型调用 `exit_plan_mode` 直接以 `NO_PROVIDER` 工具错误失败——今日 ACP 下计划模式的收尾流程不可用。

本变更来源于 `skill-output/dspm-dsh-support-requirements.md` REQ-D5（P1）与 dsh 侧评估结论、Phase 3 回复文档 §4.1：注册标准方法 `session/set_mode`、在 new/resume 响应广告 `modes`（plan / normal 二值）、`plan/mode` 提交时发 `current_mode_update`，并将 plan-review 复用既有 `session/request_permission` 通道（allow_once / reject_once 映射）——不依赖 REQ-D6 userQuestions 通道整体 ACP 化。

## 变更类型

接口级（新增 ACP 标准方法注册与响应字段；复用既有 user-questions 瀑布加 bridge 应答者；无持久化面变更）

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的场景总览与核心场景详述；新增 S51，并关联 S03、S11、S49、S50。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 新增 §11 计划模式 ACP 交互规格。
- 影响的业务场景：新增 S51「外部客户端经 ACP 感知与切换计划模式」；回归既有 S03 ACP 会话、S11 计划模式（自有 UI 通道）、S49 审批策略、S50 技能清单。
- 影响的技术架构：`core-system-map.md`（计划模式 ACP 入口）、`acp-network-system-map.md`（`session/set_mode` 方法面、modes 广告、current_mode_update 推送与 plan-review 复用审批通道）与新增 `core-S51-acp-plan-mode.md`。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 与 `acp-network-deployment-plan.md` 的发布物与部署后检查。
- 影响的 API：注册 ACP 标准方法 `session/set_mode`（请求 `{ sessionId, modeId }`，响应 `{}`）；`session/new` / `session/resume` 响应新增可选 `modes` 字段（`{ currentModeId, availableModes }`，modeId 词表 `plan` / `normal`）；模式提交经既有 `session/update` 通道发 `current_mode_update`；plan-review 经既有 `session/request_permission` 通道（新增 optionId 词表 `approve` / `keep-planning`，kind 映射 allow_once / reject_once）。不改动既有 ACP 方法的请求/响应结构，不新增 configOptions option id，不新增 capability 位（`modes` 字段在场即广告，ACP 语义如此）。
- 影响的 DB 表：无；`plan/mode` 事件与 `plan` 投影自 S11 存在，本变更零新增事件类型、零持久化格式变更，`SessionEventMap` 不变，Session format 维持 4。
- 影响的编排测试：无。
- 影响的测试规格：新增 `logos/resources/test/core-S51-test-cases.md`；更新 `logos/resources/test/smoke/acp-network-smoke-test-cases.md`（SMOKE-acp-network-05）；复用 S03、S11、S49、S50 既有回归用例。
- 实现期交付物：`packages/acp` 中英文 README 与 JSDoc、受影响包文档、keyless ACP 快照、`docs/upgrade-guide/<发布版本>/acp-plan-mode/` 中英文升级指南条目（标准方法语义、queued 时序契约、plan-review optionId 词表、plan-mode 插件缺席 fail-loud 行为；版本号随发布期确定）。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费包含 `session/set_mode` 与 `modes` 广告的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物。本变更零新增持久化数据（复用 S11 既有 `plan/mode` 事件），回滚无数据兼容问题；回滚后旧构建不认识 `session/set_mode`，客户端调用得 method not found（-32601），`modes` 字段不再出现（ACP 客户端按可选字段容忍）。
- 是否需要 smoke：是
- smoke 要求：真实 ACP 网络会话上验证 `modes` 广告（new/resume）、`set_mode` plan/normal 往返与 `current_mode_update` 时序、未知 modeId 错误分支，并回归既有 prompt/resume 通道。plan-review 映射依赖模型调用 `exit_plan_mode`，不在确定性冒烟范围，由单元与真实 API e2e 承载。

## 变更概述

在 `AcpBridge` 暴露 dsh 计划模式的标准 ACP 面：

1. **模式广告与切换（标准面）**：`session/new` 与 `session/resume` 响应新增可选 `modes: { currentModeId, availableModes }`——`availableModes` 恒为 `plan` / `normal` 二值，`currentModeId` 取会话已提交（日志折叠）状态；plan-mode 插件未组装的自定义 profile 省略该字段（ACP 语义：字段缺席即不支持，客户端按可选字段容忍）。注册标准方法 `session/set_mode`：`modeId === 'plan' | 'normal'` 经 `PlanModeController.set(agent, active)` 落地，未知 modeId 返回 invalid params 并给出可接受词表，plan-mode 缺席返回 internal error（fail-loud），响应体恒为 `{}`、不承诺立即生效——回合中切换为 `queued`（下一个 accepted in-turn pre-step 生效），既有 `cancelled` / `noop` 语义原样保留。`plan/mode` 事件提交时经 `session/update` 发 `current_mode_update`（由持久事件派生，不在 bridge 合成），queued 切换的更新随之到点到达。
2. **plan-review 复用审批通道**：bridge 在连接上注册既有 `user-questions/request` 瀑布的应答者（与 S49 审批瀑布同一注册模式）：仅拦截 bridge 自有会话上恰含一个问题且 `intent.kind === 'plan-review'` 的请求，转换为 `session/request_permission`（`Approve` → optionId `approve`、kind `allow_once`；`Keep planning` → optionId `keep-planning`、kind `reject_once`；`toolCall` 携带 intent 的 callId），先 `drainUpdates()` 保证工具调用卡片先于评审卡片到达。选中映射回 `AskUserQuestionAnswer`（`selected: [label]`）；客户端取消 outcome 映射为 `ASK_CANCELLED`（命中 `exit_plan_mode` 既有「用户收回回合」分支）；其余问题一律 `next()` 放行——`NO_PROVIDER` 语义不变，REQ-D6 通道整体 ACP 化不受影响。此修复使 `exit_plan_mode` 在 ACP 下从「必然 NO_PROVIDER 工具错误」变为完整评审闭环。
3. **时序与语义明示（dspm UI 设计输入）**：`set_mode` 响应不承诺生效；客户端以 `current_mode_update` 为唯一生效事实。回合中切换排队至下一个 accepted pre-step（`queued`）；回合间切换立即提交并紧随更新。resume 后广告已提交状态；排队中未提交的意图不跨 runtime 生存（内存态，既有控制器语义）。强制只读不在本期：plan mode 自身不读 sandbox/审批状态（README 明示 every tool remains available），强制保障按 REQ-D5 附注以 mode→preset 联动配置承载——dspm 未提出该诉求，本提案不含、如需另立项。

边界：`/plan` 命令、web 自有 UI 的计划模式投影与 `exit_plan_mode` 工具目录（稳定工具面）均不变；新增消息叙述（模型可见的用户切换通知）沿用控制器既有行为，模型可见 ⟺ 已记录不变；无 `SESSION_FORMAT_VERSION` 影响。

## 复用测试 ID

- ST-S03-01 / ST-S03-02 — 回归 ACP initialize→prompt 主链路与取消。
- S11 既有用例 — 回归 `/plan` 命令、投影折叠与自有 UI 通道不变。
- UT-S49-01 / UT-S49-05 — 回归 configOptions 面与 resume 广告结构（`modes` 为新增可选字段，不影响既有字段）。
- UT-S50-01 / UT-S50-05 — 回归 skills_list 方法面与零事件副作用（`current_mode_update` 仅由模式提交触发，枚举仍零事件）。
- SMOKE-acp-network-01..04 — 保留既有四条网络冒烟回归。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S51-acp-plan-mode.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/prd/3-technical-plan/2-scenario-implementation/core-S51-acp-plan-mode.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S51-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/test/core-S51-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/smoke/acp-network-smoke-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-plan-mode/deltas/test/smoke/acp-network-smoke-test-cases.md`
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
   git add -A && git commit -m "docs(dsh-acp-plan-mode): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive dsh-acp-plan-mode`。

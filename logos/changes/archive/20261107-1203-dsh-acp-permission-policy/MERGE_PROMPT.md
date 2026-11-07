# 合并指令

## 变更提案
- 提案名称：dsh-acp-permission-policy
- 提案目录：logos/changes/dsh-acp-permission-policy/

## 提案内容

# 变更提案：ACP 会话级审批策略配置入口（permission_policy / permission_preset）

> module: core | created: 2026-11-05

## 变更原因

dspm 经 ACP 集成 dsh，已按 fail-closed 语义实现 relay 侧 `session/request_permission` 回调与三分支审批交互（SSE 审批卡片 + REST 应答 + 超时拒绝），但 dsh 默认配置下不存在面向普通工具调用的审批触发源——`kind:'ask'` 产源仅 PreToolUse hook 与实验性 auto-review 两处，sandbox 升权直通审批 seam，普通文件写、网络与终端调用恒放行（pre-execute waterfall 默认 ALLOW）。dspm 的审批基建因此无法被端到端触发，审批能力形同虚设。

dsh 侧的审批策略覆盖机制已完整交付：`ApprovalService.setPolicy` 程序化接口、会话级 `approval/policy` 覆盖事件（LAST-wins 折叠）、模型可见切换通知与投影，全仓唯一调用方是 `/permission` 命令——缺的只是 ACP 入口。但既有词表 `'ask' | 'never'` 中 `'ask'` 为默认放行语义（转交已产生的询问）、`'never'` 为自动拒绝询问，两者都不制造询问，裸开关无法满足 dspm「配置后文件写触发审批回调」的验收场景。

本变更来源于 `skill-output/dspm-dsh-support-requirements.md` REQ-D1（P0）与 dsh 侧评估结论 `skill-output/dspm-dsh-support-evaluation.md`：以 ACP config option 为入口暴露会话级审批策略，并新增 `always`（每次工具调用先询问）档作为验收直达路径。类别级询问（ask-writes / ask-network）经评估确认无支撑面（无工具类别分类法、sandbox 无网络维度），不在本变更范围。

## 变更类型

需求级

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的场景总览与 P0 场景详述；新增 S49，并关联 S03、S21、S22。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 的 ACP 结构与 P0 场景交互规格。
- 影响的业务场景：新增 S49「外部客户端配置会话审批策略与预设」；回归既有 S03 ACP 会话、S21 敏感工具人工审批、S22 沙箱权限升级。
- 影响的技术架构：`core-system-map.md`（审批策略域）、`acp-network-system-map.md`（ACP config option 面）、`acp-S02-network-permission-prompt.md`（策略档作用于权限回环）与新增 `core-S49-acp-permission-policy.md`。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 与 `acp-network-deployment-plan.md` 的发布、配置迁移、回滚和部署后检查。
- 影响的 API：新增 ACP `session/set_config_option` 两个 option id——`permission_policy`（`ask` / `never` / `always`）与 `permission_preset`（permission-presets 预设目录）；session/new 与 session/resume 响应的 configOptions 广告相应扩展。不新增独立 ACP 方法，不改变既有 option id 行为。
- 影响的 DB 表：无；策略经既有 `approval/policy` 会话事件持久化与恢复。
- 影响的编排测试：无。
- 影响的测试规格：新增 `logos/resources/test/core-S49-test-cases.md`；更新 `logos/resources/test/smoke/acp-network-smoke-test-cases.md`（SMOKE-acp-network-03）；复用 S03、S21、S22 与 acp-network 既有回归用例。
- 实现期交付物：受影响包中英文 README 与 JSDoc、keyless ACP 快照、`docs/upgrade-guide/<发布版本>/acp-permission-policy/` 中英文升级指南条目（新增 option id、`always` 词表值、一次性选项语义保持；版本号随发布期确定）。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费包含 ACP 审批策略入口的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物。`approval/policy` 事件携带新值 `always` 的读兼容性（required-on-read 语义）在实现期评估，回滚本身不依赖日志向前兼容。
- 是否需要 smoke：是
- smoke 要求：真实 ACP 会话配置 `always` 后触发一次工具调用审批往返（allow-once 应答后工具执行），并如实记录 reject-once 分支行为。

## 变更概述

在 ACP bridge 的 `session/set_config_option` 中新增两个 option id，作为会话级审批策略的对外入口：

1. `permission_policy`（值 `ask` / `never` / `always`）：bridge 先于模型选项委托处理，调用既有 `ApprovalService.setPolicy` 落 `approval/policy` 事件并注入模型可见切换通知。`ask`（默认）放行既有触发源产生的询问；`never` 自动拒绝询问；`always` 为新增档——pre-execute 对每次工具调用产生询问并路由进既有 serviceAsk 管线，是 dspm 验收场景（配置后文件写触发 `session/request_permission`，allow-once / reject-once 应答生效）的直达路径。configOptions 在 session/new 与 session/resume 广告当前值，策略经既有事件折叠在 resume 恢复。权限应答保持一次性语义（allow-once / reject-once），不提供 `allow_always`。
2. `permission_preset`（值来自 permission-presets 既有预设目录：read-only / workspace-write / danger-full-access）：按现行定义应用 `{sandbox, approval}` 打包预设，选项目录经 `catalog()` 动态枚举，为外部客户端提供「收紧即审批」的打包面，零新机制；各预设的 approval 值沿用 permission-presets 现行定义，不在本变更中重定义。

边界：类别级询问（ask-writes / ask-network）不在本期；`/permission` 命令与 profile 会话种子的行为不因本变更改变；模型可见 ⟺ 已记录不破坏——策略切换通知与 `approval/policy` 事件均已在会话日志；`always` 作为 `approval/policy` 事件新枚举值，实现期须按 required-on-read 语义完成读兼容评估，必要时标记 `ignorable: true`。

## 复用测试 ID

- UT-S21-01 — 回归无 answerer 时 fail-closed。
- UT-S21-02 — 回归 asked/decided 事件成对落日志。
- ST-S21-01 — 回归允许后执行并留痕。
- ST-S21-02 — 回归无 answerer 拒绝。
- ST-S22-01 — 回归升级获批以新模式执行。
- ST-S22-02 — 回归 read-only 越界写被拦。
- ST-S03-01 — 回归 ACP initialize→prompt→完成主链路。
- ST-S03-02 — 回归 ACP prompt 取消。
- SMOKE-acp-network-01 — 保留既有 ACP 网络会话冒烟回归。
- SMOKE-acp-network-02 — 保留既有 ACP 网络模型调用冒烟回归。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/1-architecture/core-system-map.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/3-technical-plan/1-architecture/core-system-map.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/acp-S02-network-permission-prompt.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/3-technical-plan/2-scenario-implementation/acp-S02-network-permission-prompt.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/2-scenario-implementation/core-S49-acp-permission-policy.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/3-technical-plan/2-scenario-implementation/core-S49-acp-permission-policy.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/core-S49-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/test/core-S49-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 10. deltas/test/smoke/acp-network-smoke-test-cases.md

- Delta 文件：`logos/changes/dsh-acp-permission-policy/deltas/test/smoke/acp-network-smoke-test-cases.md`
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
   git add -A && git commit -m "docs(dsh-acp-permission-policy): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive dsh-acp-permission-policy`。

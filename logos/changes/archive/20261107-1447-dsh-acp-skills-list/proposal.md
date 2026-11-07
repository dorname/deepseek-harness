# 变更提案：ACP 会话技能清单枚举入口（session/skills_list）

> module: core | created: 2026-11-07

## 变更原因

dspm 经 ACP 集成 dsh，需要在其 UI 上呈现 agent 可用的技能入口，并按技能的调用面（模型可调用 / 用户手势可触发）区分展示。dsh 侧技能发现规则完整交付（六个根目录、优先级、同名覆盖、frontmatter 校验），但唯一对外枚举通道是 `skills/list` Typert Remote——session-addressed、仅返回 userInvocable 技能、走 dsh 自有 connection 协议；ACP 面没有任何 skill 方法。dspm 目前只能自扫 `$DSH_HOME/.dsh/skills` 约定目录兜底，把技能发现规则在客户端复制了一份，随 dsh 发现规则演进必然漂移。

本变更来源于 `skill-output/dspm-dsh-support-requirements.md` REQ-D2（P0）与 dsh 侧评估结论 `skill-output/dspm-dsh-support-evaluation.md`：在 ACP 会话面新增按需拉取的技能枚举方法，复用既有技能注册表解析逻辑，字段携带双调用旗标，令 dspm 零维护地获得与 dsh 一致的技能清单。

## 变更类型

接口级（新增 ACP bridge 扩展方法；无持久化面变更）

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的场景总览与 P0 场景详述；新增 S50，并关联 S03、S49。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-design.md` 的 ACP 结构说明与技能清单交互规格（新增 §10）。
- 影响的业务场景：新增 S50「外部客户端枚举会话技能清单」；回归既有 S03 ACP 会话、S49 审批策略配置。
- 影响的技术架构：`core-system-map.md`（技能目录 ACP 入口）、`acp-network-system-map.md`（ACP 扩展方法面与错误传播）与新增 `core-S50-acp-skills-list.md`。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 与 `acp-network-deployment-plan.md` 的发布物与部署后检查。
- 影响的 API：新增 ACP bridge 扩展方法 `session/skills_list`（请求 `{ sessionId }`，响应 `{ skills: [{ name, description, modelInvocable, userInvocable }] }`）。ACP 1.4.0 无技能标准面，该方法以 dsh 扩展方法注册并在文档明示扩展属性；不改动既有 ACP 方法的请求/响应结构，不新增 configOptions option id。
- 影响的 DB 表：无；方法为只读枚举，不落会话事件、不新增存储，`SessionEventMap` 不变。
- 影响的编排测试：无。
- 影响的测试规格：新增 `logos/resources/test/core-S50-test-cases.md`；更新 `logos/resources/test/smoke/acp-network-smoke-test-cases.md`（SMOKE-acp-network-04）；复用 S03、S49 与 acp-network 既有回归用例。
- 实现期交付物：`packages/acp` 中英文 README 与 JSDoc、受影响包文档、keyless ACP 快照、`docs/upgrade-guide/<发布版本>/acp-skills-list/` 中英文升级指南条目（新扩展方法、字段语义、registry 缺失 fail-loud 行为；版本号随发布期确定）。

## 部署影响

- 是否需要部署：是
- 部署原因：dspm 需要消费包含 ACP 技能枚举方法的新 dsh 版本或镜像及对应 commit，本地源码修改不能形成交付。
- 影响环境：staging
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到上一版 dsh 发布物。本变更为只读新增方法，不产生会话数据，回滚无数据兼容问题。
- 是否需要 smoke：是
- smoke 要求：真实 ACP 网络会话上调用 `session/skills_list`，验证技能清单返回与已知技能目录一致、未知会话错误分支生效，并如实记录技能注册表未组装时的 fail-loud 行为。

## 变更概述

在 `AcpBridge` 新增扩展方法 `session/skills_list`，按需拉取一次会话可见的技能清单：

1. **请求与响应**：请求 `{ sessionId }`（bridge 拥有的活跃会话，未知会话返回 invalid params）；响应 `{ skills }` 数组按技能名字典序排列，每项含 `name`（kebab-case 标识）、`description`（完整路由描述，不截断）、`modelInvocable` 与 `userInvocable`（解析后的双调用旗标）。不做任何调用面过滤——`modelInvocable=false`（手势专属）与 `userInvocable=false`（模型专属）技能均列出，由客户端按旗标自行区分 UI 入口；这正是注册表 invocation-neutral 设计的边界姿态：调用面策略由消费方在各自边界施加。
2. **解析链复用**：按既有 `SessionSkillCatalog` 的解析逻辑——bridge 会话恒有 live agent，经 `agentPresets.serviceFor(agent, 'skills')` 取预设作用域注册表，缺失回退全局 `ctx.get('skills')`；`cwd` 取会话 header；以 `{ cwd, scope }` 列出合并后的清单。技能注册表未组装时 fail-loud（JSON-RPC internal error 类），不返回空列表、不静默降级，与 `skill-catalog.ts` 既有姿态一致。
3. **只读与零持久化**：枚举不落任何会话事件、不进入模型 transcript、不改 `SessionEventMap` 与双 SDK 会话接口；每次调用经注册表自身缓存即时发现，不在 bridge 侧缓存（避免快照过期）。既有 `SessionSkillCatalog`（dsh 自有 UI 通道）行为不变——它保留 userInvocable 过滤，因为它是人类命令目录这一不同边界。

边界：`skills/change` 实时推送不在本期（可作为后续增量，镜像 topologyChanged → config_option_update 推送模式）；经 ACP 加载技能体不在本期（技能调用仍只经 `skill` 工具与用户手势路径）；`path` / `whenToUse` 字段不暴露（dspm 未请求；绝对路径泄漏本地文件系统结构）；ACP 标准面没有技能方法，扩展方法属性在 ACP README 与升级指南中明示。

## 复用测试 ID

- ST-S03-01 — 回归 ACP initialize→prompt→完成主链路。
- ST-S03-02 — 回归 ACP prompt 取消。
- UT-S49-01 — 回归审批策略词表校验（configOptions 面不受新方法影响）。
- UT-S49-05 — 回归 resume 后 configOptions 广告（skills_list 不改变 resume 响应结构）。
- SMOKE-acp-network-01 — 保留既有 ACP 网络会话冒烟回归。
- SMOKE-acp-network-02 — 保留既有 ACP 网络模型调用冒烟回归。
- SMOKE-acp-network-03 — 保留既有审批策略往返冒烟回归。

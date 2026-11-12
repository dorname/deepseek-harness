# 变更提案：enable-zcode-qoder-workbuddy

> module: core | created: 2026-11-12

## 变更原因
OpenLogos CLI 已升级至 0.16.7，其 Registry 新增 zcode、qoder、workbuddy 三个 AI 宿主 adapter（`openlogos init --ai-tool` 枚举已含三者，并随包分发对应集成规范 `logos/spec/{zcode,qoder,workbuddy}-plugin.md`）。本项目当前目标是通过 ACP 协议给上层应用（如 dspm）提供 AI 能力支撑，dsh 侧的开发与规格工作会在多个 AI 工具宿主间切换；仅覆盖 claude-code/opencode/codex/cursor 四宿主时，其余宿主中的会话既无方法论指令注入，也无 PreToolUse 硬 guard，流程约束与安全防护在宿主间不一致。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：CLI 0.16.7 Registry 已注册 zcode/qoder/workbuddy 三个 adapter 并随包分发三份集成规范；缺口只在 `logos/logos.config.json` 的 aiTool 数组（现四宿主）。复用：aiTool 数组扩展 + `openlogos sync` 既有部署通道，全部插件资产（`.zcode/`、`.qoder/`、`.workbuddy/`、AGENTS.md managed block、guard runtime）由 CLI 生成与自校验，不新建任何机制。
- 为什么不能更小：三宿主共享同一 sync 通道与同一配置字段，逐个启用不减少任何成本，反而留下宿主间 guard 覆盖不一致的中间态；最小完整集就是三个 id 一次入列。同批顺带完成 sync 告警要求的 core 模块 product_type 回填（`api`），否则 0.16.7 每次命令都报 PRODUCT_TYPE_CONFIRMATION_REQUIRED。
- 本提案主动砍掉的：不改 dsh 源码（`packages/`）以适配新宿主；不为新宿主定制 Skill/Command/Agent 内容（全部采用 CLI 随包模板）；不做 npm 发布、Git tag 或公开 release；不清理 .cursor 旧 rules 迁移残留之外的任何既有宿主资产；不为三宿主手写额外测试规格（插件资产由 CLI 生成并自校验，真实宿主验收属于上游 CLI 的合同，不属于本项目变更面）。

## 变更类型
代码级（判断依据：仅修改方法论配置 `logos/logos.config.json` 的 aiTool 数组与 `logos/logos-project.yaml` 的 product_type 字段，并运行 `openlogos sync` 生成 AI 宿主插件资产；不触及任何需求/设计/接口规格文档，无规格传播链）

## 变更范围
- 影响的需求文档：无
- 影响的功能规格：无
- 影响的业务场景：无
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无

实际受影响的是方法论与工具链资产（非规格文档）：`logos/logos.config.json`（aiTool +3）、`logos/logos-project.yaml`（core 模块 product_type: api）、`openlogos sync` 生成的 `.zcode/`、`.qoder/`、`.workbuddy/` 插件目录与 AGENTS.md/CLAUDE.md managed block 幂等刷新。

## 部署影响
- 是否需要部署：否
- 部署原因：纯本地方法论配置与 AI 宿主插件静态资产刷新，`openlogos sync` 已一次性完成全部落地动作；不触及 dsh 产品运行时，无服务上线或环境变更
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否（变更全部落在 git 工作树内，回退配置并删除生成目录即可，无持久化状态）
- 是否需要 smoke：否

## UI/UX 变更声明

```yaml
ui_impact: false            # 本次是否触及界面（GUI 项目才有意义）
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 仅改写 logos/logos.config.json 与 logos-project.yaml 两个配置文件及 CLI 生成的静态插件资产，不触及任何持久化数据、schema 或迁移
  compatibility:
    status: none
    reason: AGENTS.md/CLAUDE.md 仅替换 OPENLOGOS marker 内片段（marker 外用户内容保留）；三个新宿主为全新部署目录，既有 claude-code/opencode/codex/cursor 资产经 sync 幂等校验字节未变
  security_privacy:
    status: none
    reason: 新增宿主的 PreToolUse guard 为 fail-closed 扩展（deny 时 exit 2），只扩大保护面不削弱既有防护；WorkBuddy 原生记忆零读写（sync 输出确认）；无新增网络访问、遥测或凭据
  public_release:
    status: none
    reason: 全部产物仅落本地 git 工作树，未执行且未授权 npm publish、Git tag 或任何公开发布
  external_commitment:
    status: none
    reason: 不改变任何对外 API、协议承诺或服务水平；ACP 供能目标为已确认的产品方向，本变更只扩展内部工具链覆盖
decisions: []
unresolved: []
defaults: []
```

## 变更概述
OpenLogos 宿主覆盖面从四宿主扩到七宿主：`logos/logos.config.json` 的 aiTool 数组新增 zcode、qoder、workbuddy；`openlogos sync` 随即部署三份宿主插件（`.zcode/plugins/openlogos`、`.qoder/plugins/openlogos`、`.workbuddy/plugins/openlogos`，各含 skills/commands/agents/hooks，ZCode 另含共享 runtime），并幂等刷新 AGENTS.md/CLAUDE.md 的 OPENLOGOS managed block、`logos/spec/` 25 份规范与 `logos/skills/` 17 个 Skill。

同批回填 `logos/logos-project.yaml` 中 core 模块的 `product_type: api`。判定依据 `logos/spec/logos-project.md:386` 的边界：对外暴露 HTTP/RPC 接口的后端服务为 `api`、无对外接口的纯后台进程为 `service`；dsh 经 ACP（JSON-RPC）对上层应用（dspm）供能，命中 `api` 定义。该回填消除 0.16.7 每次命令的 PRODUCT_TYPE_CONFIRMATION_REQUIRED 告警。

dsh 源码（`packages/`、`python/`、`native/`）零改动；无规格 delta、无代码切片、无部署任务。三个新宿主的插件需各自新建宿主 session 方才生效（快照机制），既有宿主行为不变。

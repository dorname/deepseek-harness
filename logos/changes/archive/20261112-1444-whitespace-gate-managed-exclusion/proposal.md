# 变更提案：whitespace-gate-managed-exclusion

> module: core | created: 2026-11-12

## 变更原因
change enable-zcode-qoder-workbuddy 落库时，pre-commit whitespace 门（`git diff --cached --check`，lefthook.yml）被 openlogos 0.16.7 随包字节的行尾空白阻断：违规点 1000+ 处，全部位于 OpenLogos CLI 托管树（`.cursor/skills`、`.zcode/`、`.qoder/`、`.workbuddy/` 的 plugins、`logos/skills`、`logos/spec`、verify 报告产物），无一处是本仓库手写字节。托管字节的事实源在上游包：本仓库清洗后，下一次 `openlogos sync` 会原样还原，形成漂移循环，提交被永久阻断。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：`.gitattributes` 已有 OpenLogos managed `-text` 块为同一批树声明行尾保真（但 `-text` 不豁免 `git diff --check`）；lefthook lint job 已有 `vendor/*/src/**` 排除先例（vendored 源不做本仓库 lint）——本变更复用同一模式（vendored/托管字节不做本仓库格式检查），仅扩展到 whitespace job。
- 为什么不能更小：只排除今日实际报错的目录，会在下次 sync 带入新的带空白托管资产时再次阻断提交；与 `.gitattributes` 托管清单同族的完整排除才能闭环。逐文件清洗不可行——sync 会还原（字节属上游）。
- 本提案主动砍掉的：不用 `-diff` gitattributes 属性（会使托管资产 diff 不可读）；不清洗托管字节（与 sync 通道打架，见变更原因）；不豁免 `logos/changes/` 与 `logos/logos.config.json`（本仓库手写内容，保持受门保护）；不设 per-file 精确白名单（维护成本高于目录级排除，且字节随上游版本浮动）。

## 变更类型
代码级（判断依据：仅修改 lefthook.yml 的 whitespace job 一处命令——从裸 `git diff --cached --check` 改为带托管树排除的 pathspec 调用；不触及任何规格文档。注意：本变更属 git 钩子配置调整，无需代码实现切片、无代码任务、不进入实现循环——OpenLogos 的 code_required 门针对需要业务代码实现与测试收敛的变更，本变更已完成且无测试收敛需求）

## 变更范围
- 影响的需求文档：无
- 影响的功能规格：无
- 影响的业务场景：无
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无

实际受影响的是仓库 git 钩子配置：`lefthook.yml` pre-commit 的 whitespace (staged) job。

## 部署影响
- 是否需要部署：否
- 部署原因：git 钩子配置随仓库分发，clone/postinstall 自动生效；无服务上线或环境变更
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否（单文件单 job 回退即可，无持久化状态）
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
    reason: 仅修改 lefthook.yml 一个 git 钩子配置文件，不触及任何持久化数据
  compatibility:
    status: none
    reason: whitespace 门的排除范围与 .gitattributes 既有 OpenLogos managed -text 块同族（同一批托管树），语义对齐；本仓库手写文件（logos/changes/、logos/logos.config.json、packages/ 等）的空白检查行为不变
  security_privacy:
    status: none
    reason: 排除只作用于外部 CLI 托管树的空白检查，不影响任何安全门禁；托管树的其他检查（vendor manifest guard、lint 按 glob 天然不匹配）不受影响
  public_release:
    status: none
    reason: 仓库内部钩子配置调整，无对外发布行为
  external_commitment:
    status: none
    reason: 不改变任何对外承诺或接口
decisions: []
unresolved: []
defaults: []
```

## 变更概述
lefthook.yml pre-commit 的 whitespace (staged) job 从裸 `git diff --cached --check` 改为带 11 个 OpenLogos 托管树 pathspec 排除的调用（`.agents/plugins/openlogos`、`.claude/openlogos`、`.cursor/skills`、`.cursor/hooks`、`.opencode`、`.zcode`、`.qoder`、`.workbuddy`、`logos/skills`、`logos/spec`、`logos/resources/verify`），与 `.gitattributes` 既有 managed `-text` 块覆盖同一批树。理由：这些树的字节事实源在 openlogos 上游包，本仓库清洗会被 `openlogos sync` 还原；排除是唯一不与同步通道打架的收敛点（与 lint job 对 `vendor/*/src/**` 的既有排除同模式）。

`logos/changes/`、`logos/logos.config.json` 及其余全部仓库文件仍受空白门检查。已实测：排除后 `git diff --cached --check` 对当前 staged 集合 exit 0。本变更无需代码切片（配置改动已随提案执行完毕），无代码任务、无部署任务。

# 部署报告：ACP 会话技能清单枚举（dsh-acp-skills-list）

> 提案：`dsh-acp-skills-list`
> 时间：2026-11-07T14:52+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；ACP-over-network 真实 WebSocket 往返 + 既有 Secret）
> 发布物源码 commit：`f148f8aeca`（版本 0.2.1-alpha.1）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `f148f8aeca`） | 成功（355 client artifacts） |
| SMOKE-acp-network-01/02/03/04 真实协议冒烟（临时账本 + 官方 dispatcher 四通道） | PASS ×4（04 为本变更新增技能枚举通道；SMOKE-04 种子五技能、fixture 旗标命中、未知会话错误、prompt 往返后重列一致） |
| S50 + S49 回归套件（reporter 账本） | 10/10 通过（UT-S50-01..05 全量；UT-S49-01/02/05/06 + ST-S49-02 既有回归） |
| acp-network 既有单元回归 | 4/4 通过 |
| `openlogos smoke`（Gate 3.8，官方 dispatcher 串行全量） | PASS：17 通过 / 0 失败 / 12 跳过，覆盖 100%（29 用例，含新增 SMOKE-acp-network-04） |
| `openlogos verify`（Gate 3.6，对最终账本与最终规格文本） | PASS：211 定义用例、0 失败、151 基线跳过、覆盖 100%；pre_run exit=0（412s） |

## 部署方案逐项验证（acp-network 计划四步 + core-01 步骤）

1. **有效 token 连接后 `session/new` 并调用 `session/skills_list { sessionId }`** — SMOKE-04 真实 WebSocket 客户端枚举成功，响应为 `{ skills: [...] }` 数组。
2. **清单与部署环境已知技能目录（用户级与项目级根目录）一致性** — SMOKE-04 在会话 cwd 项目级根（`.dsh/skills` + `.agents/skills`）种子三个技能（手势专属 / 模型专属 / 双面），断言：名字典序、每项恰含 `name` / `description` / `modelInvocable` / `userInvocable` 四字段且标量类型合法（对超集条目同样成立）、fixture 三项 frontmatter 解析旗标逐一命中（`disable-model-invocation` → model=false、`user-invocable: false` → user=false、缺省 → 双 true）；keyless 快照 `snapshots/acp/skills-list` 以相同三技能目录固定方法面与映射行为；目录发现经真实 `@deepseek-ai/dsh-skill-filesystem`（本地组合与部署同为 `dsh-base` 默认装配）。
3. **未知会话 id 验证 invalid params 分支** — SMOKE-04 断言 `unknown session: unknown-id`（-32602 类）；UT-S50-01 同断言 + 空参数对象走扩展解析器（`requires a non-empty sessionId string`）；registry 缺失 fail-loud（internal error 类，说明缺装配、不返回空列表）由 UT-S50-04 在无 `dsh-skill` 组合上复现——提案 smoke 要求的 fail-loud 行为如实记录，SMOKE-04 本地组合恒含注册表，故该分支由单元层承载。
4. **既有回归保持** — prompt/resume：SMOKE-01/02 本轮 pass；`skills/list` UI 通道（`SessionSkillCatalog`，本变更零改动）：`openlogos verify` pre_run 全量套件覆盖；S49 审批策略路径：SMOKE-03 + UT-S49-01/02/05/06 + ST-S49-02 本轮 pass；SMOKE-04 内 prompt 往返 + 重列一致断言确认枚举与模型通道互不干扰。

## 只读与零持久化行为（本次变更核心）

- 枚举不落会话事件、不进模型 transcript、不缓存于 bridge；UT-S50-05 断言重复调用结果一致且会话日志零新增事件。`SessionEventMap` 与双 SDK 会话接口不变，无持久化格式变更，Session format 维持 4。
- `session/skills_list` 以 dsh 扩展方法注册（ACP 1.4.0 无技能标准面），扩展属性在 acp README（中英）与升级指南明示；`skills/change` 推送与技能体 ACP 加载为文档化的本期边界（客户端重拉；调用仍走 `skill` 工具）。

## 部署后检查（core-01 计划）

- `skills_list` 响应结构合法（数组、字典序、四字段）：✅（SMOKE-04 + 快照 + UT-S50-01/03）
- 响应时限（≤2s 检查线）：✅（官方 dispatcher 四通道合计 1802ms，枚举调用本身毫秒级，本地组合与 staging 同构）
- 未知会话错误分支：✅（SMOKE-04 + UT-S50-01）
- SMOKE-acp-network-01/02/03 既有回归：✅（本轮 dispatcher 全过）
- 服务启动：✅（冒烟自举 acp-network profile 子进程，initialize → session/new → 枚举 → prompt 全链路）

## 回滚点

1. 回滚基线：上一版发布物 commit `da8e79a698`（已归档变更 dsh-acp-permission-policy 的发布态）；revert 本变更线两个提交（`13f980a16a` 规格合并、`f148f8aeca` 实现）后重建即可。
2. 会话数据无需回滚迁移：方法只读、无会话数据与配置变更；回滚后旧构建不认识 `session/skills_list` 方法名，客户端调用将收到 method not found（JSON-RPC -32601）——升级指南已按扩展方法属性说明客户端应容忍该方法缺席。
3. 配置面：不新增 Secret、环境变量或 profile 配置项；`acp` / `acp-network` profile 经 `dsh-base` 已挂载技能插件，部署无新增装配。自定义 profile 若剥离技能插件，方法返回 internal error（文档化 fail-loud，非部署缺陷）。

## 升级指南

`docs/upgrade-guide/v0.2.1-alpha.1/acp-skills-list/`（中英文）：新扩展方法语义（双旗标、不过滤）、空目录与未挂载注册表的区分、只读与无推送（客户端重拉）、方法缺席容忍。

## 未解决风险

- **无 S50 范围未解决项。**
- 本机自跳过与上一版发布物一致（非本变更回归）：postgres 支撑的 fleet/storage 套件与 SMOKE-core-12..19（root 环境 embedded-postgres initdb 拒绝）、SMOKE-core-08（需签名安装器人工验证）、SMOKE-core-09/10/11（fleet staging supervisor 未运行）、stagehand 浏览器快照（本机 load-hook 环境红）。CI 平台矩阵负责这些信号。

## 执行命令

```sh
pnpm run build
OPENLOGOS_SMOKE_RESULT_PATH=/tmp/s50-deploy-smoke.jsonl \
  pnpm exec tsx scripts/smoke-acp-network.ts        # SMOKE-acp-network-01..04 真实冒烟
OPENLOGOS_RESULT_FILE=/tmp/s50-deploy-tests.jsonl \
  pnpm exec vitest run packages/acp/acp/tests/skill-list.spec.ts \
           packages/acp/acp/tests/permission-control.spec.ts \
           packages/acp/acp/tests/permission-roundtrip.spec.ts
pnpm vitest run packages/acp/acp-network            # acp-network 既有回归
openlogos smoke                                     # Gate 3.8 PASS
openlogos verify                                    # Gate 3.6 PASS（pre_run exit=0，[code] 切片末执行）
```

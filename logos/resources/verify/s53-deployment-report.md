# 部署报告：多供应商路由供给面（dsh-acp-multi-provider）

> 提案：`dsh-acp-multi-provider`
> 时间：2026-11-08T21:10+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；ACP-over-network 真实 WebSocket 往返走本地 mock HTTP 路由；真实 DeepSeek API 回归经 Gate 3.8 的 SMOKE-core-06/07/25 与 dict 供给既有面）
> 发布物源码 commit：`2597e763c7`（实现链 `ecc9894cfd` feat → `1a5d9984ac` test → `d010fcff49` docs → `f7a928dab3` runner lane → `2597e763c7` verify 证据；版本 0.2.1-alpha.1）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `2597e763c7`） | 成功（355 client artifacts） |
| 冲突矩阵独立进程启动（core-01 §十五 步骤 3，临时 `DSH_HOME` 五 profile，真实 `pnpm dsh` 加载） | 4/4 加载期硬失败、exit 1、诊断指名路由与来源：组合双键 `config.ts:403 both supply routes`、重复路由键 `config.ts:415 declares route "alpha" more than once`、缺路由键 `$.providerList[0].provider missing required value`（schema 校验层先行拦截，同样 fail-loud）、dict 值 `provider` 字段迁移守卫 `provider "alpha" sets "provider", which moved to the providers dict key` |
| 数组 × settings 合并冲突（进程 + UT 双承载） | 进程证据：`settings.yaml` 一次性导入被拒——文件重命名为 `settings.yaml.imported`、被拒 section 仅留存于改名文件、boot 继续且路由保持 providerList-only；运行时写路径（web Models 页同款通道）`settings.update` 本身 reject `both supply routes` 且路由保持服务（loader-composition.spec 真实 Loader + Settings + configEditor UT 承载） |
| SMOKE-acp-network-01..07（临时账本 + 官方 dispatcher 七通道） | PASS ×7（07 为本变更新增多供应商供给面：本地组合 providerList × 两 mock HTTP 路由的分组广告、默认值对、`set_config_option` 切换命中、fresh client resume 持久、冲突组合加载失败五段断言；staging 无数组供给通道按 skip 语义 handshake skipped，永不报 PASS） |
| S53 + S52 + S51 + S50 + S49 回归套件（reporter 账本） | 10 文件 / 94 测试全部通过，28 账本记录全 pass（ST-S53-01、UT-S49-01..06、ST-S49-02、UT-S50-01..05、UT-S51-01..06、UT-S52-01/03..06 等；UT-S53-01..04 由 config.spec 7 例 + loader-composition.spec 3 例承载，账本待遇与 S50/S51/S52 同约定） |
| `openlogos smoke`（Gate 3.8，官方 dispatcher 串行全量） | PASS：20 通过 / 0 失败 / 12 跳过，覆盖 100%（32 用例，较 D4 期新增 SMOKE-acp-network-07；SMOKE-core-06/07/25 真实 API 通道全绿；SMOKE-core-24 全链路经客户端代理配置构建后 pass，cpu 峰值 10.5%） |
| `openlogos verify`（Gate 3.6，对最终账本与最终规格文本） | PASS：61 通过 / 0 失败 / 169 基线跳过、覆盖 100%（230/230）、设计时校验 14/14；pre_run exit=0（514s；[code] 切片末执行，发布树此后未再变更） |

## 部署方案逐项验证（core-01 §十五）

1. **发布物与前置检查** — 355 artifacts 构建于 `2597e763c7`；config-catalog 已随 [code] 重生成（新增 `providerList` 字段与 `PiAiProviderListEntry` 接口）；`docs/upgrade-guide/v0.2.1-alpha.1/acp-multi-provider/` 中英文指南已入库（双键定义、settings dict-only、冲突 fail-loud 词表、dict-vs-数组选型、dspm 组合示例、回滚 patch 还原注意）。
2. **staging 数组组合 → SMOKE-acp-network-07** — 本地 staging 等效组合确实供给 llm-pi-ai 数组节，故 07 以本地通道全量执行并 PASS；无数组供给的 staging 目标按方案的 skip 语义记录（本轮 dispatcher 的 staging handshake skipped），未报 PASS。
3. **冲突矩阵** — 见执行摘要：四个加载期分支以独立启动进程实测（临时 `DSH_HOME`，`cordis.yml` 根保持 `[]`、组合补丁写 `cordis.patch.yml`，未触任何真实凭据，`S53_CONFLICT_KEY` 为占位名）；数组 + settings 合并冲突的两条语义（导入期拒绝继续运行、运行时写路径拒绝且路由保持）分别由进程证据与真实 Loader UT 记录。
4. **回归** — SMOKE-acp-network-01..06 全过（prompt/resume、permission、skills、plan mode、compaction 面）；S03 健康与真实 API 链路（core-01..07）全过；S49 审批策略、S50 技能枚举、S51 计划模式、S52 压缩面单元回归全过；dict/settings 供给面经 core-04/05/06/07 与既有 provider 发现通道回归。

## 部署后检查（core-01 §十五）

- 数组组合路由注册与 configOptions 分组广告：✅（SMOKE-07 两分组四值 + ST-S53-01）
- 跨供应商切换命中与 resume 持久：✅（SMOKE-07 `set_config_option` 切换 + fresh client resume；ST-S53-01 进程级重启 resume）
- 冲突诊断指名路由与来源：✅（五个独立进程启动，§十五 步骤 3 全分支）
- SMOKE-acp-network-01..06 既有回归：✅（本轮 dispatcher 全过）
- settings 文档 dict-only 写入门：✅（loader-composition.spec：写 `providerList` 被 `Config field "providerList" is not volatile` 拒绝；providers dict 写入正常）
- 服务启动：✅（冒烟自举 acp-network profile 子进程全链路；冲突矩阵自举 shipped headless profile 全链路）

## 只读与零持久化行为

- 本变更零新增持久化事件类型与 Secret/环境变量：`providers` 保持 volatile settings 节（settings 文档活编辑），`providerList` 为组合专用非易变键（settings 写入门 `isVolatilePath` 拒绝），均不进入会话日志；`SessionEventMap` 无新增成员，Session format 维持；回滚无迁移。
- `apiKeyEnv` 引用的凭据经既有凭据解析（凭据存储或环境），键本身不入配置、不入报告。

## 回滚点

1. 回滚基线：上一版发布物为 D4 归档态 `d6d9167d29`（本变更线合并提交 `b22f9bda2a` 的父提交）；revert 本变更提交（`b22f9bda2a`、`ecc9894cfd`、`1a5d9984ac`、`d010fcff49`、`f7a928dab3`、`2597e763c7`）后重建即可。
2. 会话数据无需回滚迁移：零新增持久化事件类型；已注册路由行为与回滚前一致。
3. **回滚须同时还原组合 patch 中的 llm-pi-ai 数组节**：旧构建的配置 schema 拒绝数组形式，带着数组节回滚会在加载期失败；该注意项已写入升级指南（组合 patch 行须携带完整配置的整键替换语义同注）。回滚后数组组合不可用，dict 组合与单路由部署不受影响。

## 升级指南

`docs/upgrade-guide/v0.2.1-alpha.1/acp-multi-provider/`（中英文）：`providers`/`providerList` 双键定义与归一化、settings dict-only 写入门、冲突 fail-loud 词表（两键同供/重复路由键/缺路由键/dict 迁移守卫）、dict-vs-数组选型说明、dspm 生成式 fleet manifest 组合示例、patch 行整键替换与回滚还原注意。

## 未解决风险

- **无 S53 范围未解决项。**
- 本机自跳过集与 D4 期一致（非本变更回归）：SMOKE-core-12/13/16..19（root 环境 embedded-postgres initdb 目录权限拒绝）、SMOKE-core-08（需签名安装器人工验证）、SMOKE-core-09/10/11（fleet staging supervisor 未运行）、SMOKE-core-14/15（同 supervisor 依赖）。CI 平台矩阵负责这些信号；k8s staging 集群不在本机环境。
- 执行插曲（已闭环）：冲突矩阵首轮工位把组合条目误写入根 `cordis.yml`（正确形状为根保持 `[]`、补丁写 `cordis.patch.yml`），修正前的 5 次启动把提示词当任务执行、消耗少量真实 API 额度；随后以 `DEEPSEEK_BASE_URL` 指向不可达地址作为止损阀并完成修正。修正后五次启动全部按预期在加载期失败，无凭据、无额外模型消耗。红色中间态未入任何提交。
- 构建缓存的 GC 压力使 cluster lane 在 args 完全一致时仍可能全量重建（约 6 分钟/镜像）；`~/.docker/config.json` 的 `proxies.default` 客户端注入保证重建走可达代理，lane 无论命中与否都能完成（本轮 SMOKE-core-24 即重建路径 pass）。该缓解为本机环境配置，不入仓库。

## 执行命令

```sh
pnpm run build                                        # 355 client artifacts @ 2597e763c7
DSH_HOME=/tmp/s53-deploy-conflict pnpm dsh --profile dual-config "+"   # 组合双键 → exit 1
DSH_HOME=/tmp/s53-deploy-conflict pnpm dsh --profile dup-route "+"     # 重复路由键 → exit 1
DSH_HOME=/tmp/s53-deploy-conflict pnpm dsh --profile missing-key "+"   # 缺路由键 → exit 1
DSH_HOME=/tmp/s53-deploy-conflict pnpm dsh --profile dict-guard "+"    # dict 迁移守卫 → exit 1
DSH_HOME=/tmp/s53-deploy-conflict pnpm dsh --profile dual-settings "+" # 数组×settings 导入拒绝,boot 继续
OPENLOGOS_SMOKE_RESULT_PATH=/tmp/s53-deploy-smoke.jsonl \
  pnpm exec tsx scripts/smoke-acp-network.ts          # SMOKE-acp-network-01..07 全过
OPENLOGOS_RESULT_FILE=/tmp/s53-deploy-tests.jsonl \
  pnpm exec vitest run packages/llm/llm-pi-ai/tests/config.spec.ts \
           packages/llm/llm-pi-ai/tests/loader-composition.spec.ts \
           packages/acp/acp-network/tests/multi-provider.spec.ts \
           packages/acp/acp-network/tests/network.spec.ts \
           packages/acp/acp/tests/compaction.spec.ts \
           packages/acp/acp/tests/plan-mode.spec.ts \
           packages/acp/acp/tests/skill-list.spec.ts \
           packages/acp/acp/tests/permission-control.spec.ts \
           packages/acp/acp/tests/permission-roundtrip.spec.ts \
           packages/interaction/user-approval/tests/approval.spec.ts   # 94/94,28 账本全 pass
openlogos smoke                                       # Gate 3.8 PASS（20/0/12,32 用例）
```

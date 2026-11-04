# core 实现清单（implementation）

> 最后更新：2026-11-04
> 文档性质：存量项目逆向整理的实现基线。0.2.1-alpha.1 的代码已全部实现；本清单把 Phase 1 场景映射到承担实现的主责包与既有验证命令，作为后续变更迭代的定位索引（按 `openlogos change` 流程补充新实现时，在本清单追加条目）。

## 一、场景 → 实现映射

| 场景 | 主责实现（包/入口） | 既有验证 |
|------|--------------------|---------|
| S01 Web UI 启动 | `apps/cli`（启动器）、`packages/bundle/web-app`、`packages/host/*`（webserver/frontend-static）、`packages/client/*`（63 个 UI 包） | `pnpm run test`（loader smokes）、`dsh web --dump-config` |
| S02 headless | `packages/bundle/headless`、`packages/core/agent-loop` | `pnpm run test:snapshot`（录制会话回放） |
| S03 ACP | `packages/acp` | 单测 + ACP 协议适配器快照 |
| S04 插件管理 | `packages/boot/plugin-manager`、`apps/cli/src/args.ts:187-199` | `verify-application-entrypoints` 等脚本门 |
| S05 公开部署 | `packages/bundle/web-app/src/startup.ts:59-63`、`packages/util/http-proxy` | e2e（需 key 自跳过） |
| S06 Python SDK | `python/sdk`、`python/sdk-runtime` | Python 侧测试（hatchling 工程） |
| S07 TS SDK | `packages/sdk/*`（protocol/jsonrpc-server/client） | 单测 + e2e |
| S08 Desktop | `apps/desktop`、`apps/desktop-host` | 打包构建 + 手工冒烟 |
| S09/S10 hooks 桥 | `packages/hooks/*`（protocol/claude-code/codex） | 单测（matcher/codec） |
| S11 计划模式 | `packages/plan/plan-mode` | 单测 + 会话快照 |
| S12 todo | `packages/todo/tool-todo` | 单测 |
| S13 子代理 | `packages/subagent/*`（10 包：seam + spawn/fork/acp/claude-code/codex/dsh-sdk/in-process-driver + 2 工具） | 单测 + 快照 |
| S14 workflow | `packages/workflow/*`（seam、ptc 引擎、tool-workflow、tool-ralph） | 单测 |
| S15 压缩 | `packages/compaction/*`（basic、tool-result-pruner、image-offload、command-compact） | 单测 + 回放 |
| S16 提醒 | `packages/schedule/*` | 单测 |
| S17 GitHub webhook | `packages/webhook/*`（runtime + github 适配器） | 签名校验单测 |
| S18 MCP | `packages/mcp/*`（client、resources） | 单测（mock server） |
| S19 技能 | `packages/skill/*`（filesystem、office、badge + tool-skill） | 单测 |
| S20 模型设置 | `packages/credentials/*`、`packages/settings`、`client` Models 设置页 | 单测 |
| S21 审批 | `packages/interaction/user-approval`、`permission-presets` | 单测（fail-closed） |
| S22 沙箱升级 | `packages/shell/tool-bash`、`packages/sandbox/*`（local/ssh/windows-acl/policy） | 单测 + 平台矩阵（CI） |
| S23 提问 | `packages/interaction/tool-ask-user`、`user-questions` | 单测 |
| S24 目标 | `packages/goal/*` | 单测 |
| S25 反馈 | `packages/feedback/*` | 单测 |
| S26 持久化/导出 | `packages/session/*`（persistence-jsonl、checkpoint-policy、format 迁移链 v0→v4） | 单测 + 快照 |
| S27 分叉 | `packages/core/session`（fork）、`session-format` | 单测 |
| S28 搜索 | `packages/session-query/*`（sqlite FTS5 + 5 个工具） | 单测 |
| S29 交付物 | `packages/deliverables/*`（tool-present、workspace-changes） | 单测 |
| S30 附件 | `packages/attachment/*` | 单测 |
| S31 网关登录 | `packages/fleet/gateway`（OIDC 授权码 + 网关会话）、`packages/bundle/web-app`（`--trust-loopback-gateway`）、`packages/client/connection`（信任转发 authority） | UT/ST-S31（JSONL reporter）+ `SMOKE-core-09` |
| S32 跨用户隔离 | `packages/fleet/gateway`（按主体严格路由、回环启动令牌 jar） | UT/ST-S32（JSONL reporter）+ `SMOKE-core-10` |
| S33 fleet 生命周期 | `packages/fleet/fleet-manager`（开通/回收/重启/上限）、`packages/identity/anonymous-user-id`（fleet 审计归属） | UT/ST-S33（JSONL reporter）+ `SMOKE-core-11`、`ST-S33-03` CPU 约束 runner（`scripts/fleet-staging/`） |
| S48 provider 模型动态发现 | `packages/llm/llm-deepseek-api-key`（`src/discovery.ts`：有界、可取消、成功才缓存的端点目录发现；第二轮修订：列表 URL 候选链——主候选 404/405 且路径命中已知 Anthropic 兼容网关后缀时剥后缀试 `{root}/v1/models`、`{root}/models`，官方 `api.deepseek.com` 路由的列表在 origin 根）、`packages/llm/llm-deepseek`（`messagesApiRoot()`、无默认可复用 models schema、可取消 `listModels`）、`packages/acp/acp`（`model-control.ts` 实时目录校验、发现错误传播、移除模型不回填选项）、`packages/client/ui-settings-models`（端点发现展示态） | UT-S48-01..07 + ST-S48-01/02（JSONL reporter）+ keyless 快照 `stale-model-options` + `SMOKE-core-25`（`scripts/smoke-deepseek-discovery.ts`，仅真实 provider 出 AC-6 证据） |

## 二、横切机制实现

| 机制 | 实现 |
|------|------|
| 插件运行时 | vendored Cordis（`vendor/cordis`，rescope `@deepseek-ai/cordis`）；profile/bundle 组合（`packages/bundle/*`、`boot/app-boot`） |
| 事件与循环 | `packages/core/*`（session、system-prompt、tools、agent、agent-loop、scope）；turn/step 事件链见 `docs/architecture.md` §Turn flow |
| 模型接入 | `packages/llm/*`（llm、deepseek、pi-ai、retry、token-meter、api-extensions、鉴权发现） |
| 审计不变式 | 「Model-visible ⟺ logged」：`packages/core/session` + `session-log-deepseek` |
| 原生沙箱原语 | `native/system`（landlock-run、flock，按平台 optionalDependencies） |

## 三、既有验证面（命令 → 覆盖）

| 命令 | 覆盖 |
|------|------|
| `pnpm run test` | 全仓单测 |
| `pnpm run test:coverage` | CI 覆盖率门：per-file 100%（`packages/*/*/src`） |
| `pnpm run test:snapshot` | 无 key 录制会话回放（shipped profiles） |
| `pnpm run test:e2e` | 真实 API（无 key 自跳过） |
| `pnpm run typecheck` / `lint` / `duplication` / `hygiene` | 静态门 |
| `pnpm run test:expected` | owner-local 进程期望 |

## 四、OpenLogos reporter 接入现状

按 `logos/spec/test-results.md`，生成的测试代码须将用例 ID + 结果写入 `logos/resources/verify/test-results.jsonl`。fleet 域（S31–S33）与 S48 的 vitest 套件已通过 `OPENLOGOS_RESULT_FILE` 环境门控的 reporter 按 `UT-*/ST-*` ID 追加 JSONL（S48 套件：llm-deepseek-api-key `discovery.spec.ts`、acp `model-control.spec.ts`/`bridge.spec.ts`、llm-deepseek `loader-composition.spec.ts`/`scenario-discovery.spec.ts`）；`scripts/run-openlogos-tests.js`（`verify.pre_run_command`）负责清空账本、运行 fleet 套件、S48 套件与 `ST-S33-03` 验收 runner，并对 S01–S30 逆向基线用例补写显式 `skip` 记录（其行为由存量包测试承担）。`scripts/run-smoke.js`（`smoke.command`）串行执行自动发现的 `scripts/smoke-*` runner（含 S48 的 `smoke-deepseek-discovery.ts`），把 `SMOKE-core-*` 结果写入 `logos/resources/verify/smoke-results.jsonl`。存量 S01–S30 域的 reporter 桥接仍属后续变更；本清单为其提供用例 ID 来源（`logos/resources/test/core-S*-test-cases.md`）。

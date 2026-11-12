# AGENTS.md

DeepSeek Harness is an all-plugin Cordis agent harness. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Pre-stable APIs and released Session data

Public APIs are pre-stable; update every consumer. Follow [version/status](docs/session-format-status.md) and [type acknowledgements](docs/cookbook/reviewing-persistence-type-changes.md). [Adjacent migration](.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md) may add a version-named successor but never move, overwrite, or delete committed generations; predecessors imply neither fallback nor downgrade support. SQLite uses monotonic `SCHEMA_VERSION`.

Acknowledge [declared persistence-type changes](docs/cookbook/reviewing-persistence-type-changes.md).

Record each externally perceptible breaking change immediately in an [upgrade guide](.agents/skills/dsh-create-upgrade-guide/SKILL.md).

**Application launch.** Only `dsh` profiles launch supported Node apps; package bins, demos, and public SDK argv escapes are forbidden ([rule](docs/architecture.md#application-launch)).

## Repository layout

```
vendor/      Vendored Cordis (vendor/README.md)
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/                 agent/session API
  api/                  remote BFF
  typert/               type graphs
  llm/                  model providers
  shell/                command execution
  subprocess/           child-process management
  ssh/                  SSH execution providers
  terminal/             persistent terminals
  ptc-runtime/          PTC execution
  sandbox/              process confinement
  deliverables/         turn deliverables
  fs/                   filesystem access
  lsp/                  language servers
  skill/                skill loading
  web/                  search/fetch tools
  computer-use/         computer interaction
  browser-use/          browser interaction
  compaction/           context compaction
  context/              request context
  subagent/             delegated agents
  jobs/                 background jobs
  bundle/               profile bundles
  workflow/             workflow execution
  webhook/              webhook ingress
  todo/                 todo_write tool
  plan/                 logged planning
  goal/                 session goals
  schedule/             scheduled follow-ups
  preset/               agent composition
  guard/                loop/tool guards
  extensions/           runtime self-modification
  hooks/                Claude Code/Codex bridges
  session/              durable sessions
  session-query/        browsing/search/export
  attachment/           binary attachments
  spill/                output spill
  storage/              non-session storage
  workspace/            workspace entities
  feedback/             human feedback
  identity/             anonymous identity
  settings/             user settings
  credentials/          credentials/authorization
  acp/                  automation-only ACP
  interaction/          human interaction
  boot/                 application boot
  sdk/                  JSON-RPC SDK
  host/                 GUI host
  client/               GUI client
  mcp/                  external tools
  experimental/         pre-stable prototypes; public by default with explicit private exceptions
  test-support/         test infrastructure
  util/                 zero-dependency utilities
python/      Python SDK/runtime (python/README.md)
native/      @deepseek-ai/node-addon-system source (native/README.md)
benchmarks/  performance gates
.agents/     Agent workflows/notes
docs/        Documentation (docs/AGENTS.md)
scripts/     gates and generators
website/     VitePress documentation projection
```

Package groups: [packages/README.md](packages/README.md).

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean           # remove build outputs and safe residue from deleted packages
pnpm run test           # unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without DEEPSEEK_API_KEY
pnpm run test:expected  # owner-local process expectations
pnpm run test:snapshot  # keyless recorded-session replay through shipped profiles; filter: -t <name>
pnpm run test:snapshot:record  # re-record expected outputs (needs key)
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run hygiene        # publint + workspace/package/dependency checks + NodeNext consumer check
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine); CI owns this signal
pnpm run doc-sync       # documentation gates (scripts/run-gates.ts)
pnpm run test:docs      # quick documentation checks (no build; doc-quick aggregate)
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm dsh --profile headless "task"  # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run demo:ptc -- "task"  # headless PTC mode run (needs key)
pnpm run dev:web | dev:desktop  # build, then launch; Web also rebuilds client bundles on edits. start:web | start:desktop skip the build
make web|dev-web|desktop|dev-desktop|build  # the same commands; ARGS='--no-open' forwards options
```

### Host sandbox failures

If a required `gh`, `pnpm`, build, test, or generator command fails because the sandbox blocks credentials, network, IPC, watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation. Require sandbox evidence; never bypass test failures or the product sandbox.

### Run relevant checks locally

Before pushing, follow [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report only commands run. After `gh stack sync`, validate immediately; do not merge before checks pass.

- Match evidence to the surface: focused behavior tests, model/user-output snapshots, `doc-sync` for docs, built smokes for published paths, and real-API e2e for providers.
- Never default to the full suite or repeat a passing check for commit or push. CI owns exhaustive coverage and the platform matrix; rehearse all locally only by explicit request, for CI diagnosis, or for an irreducibly repository-wide change.
- `test:coverage`, not `test`, is the CI coverage gate ([why](docs/testing.md)).
- **Web browser automation and GIF recording:** launch with `pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml` to use the [in-page directory picker](apps/web/tests/pin-browse-picker.overlay.yml); omit this override only when testing native picker behavior explicitly.

## Secrets / .env

Windows packaging/signing: [required reading](apps/desktop/README.md#windows-ev-signing).

Real-API tests/demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Packages use `@deepseek-ai/dsh-<name>`; vendor is [rescoped](docs/rescope.md) and `private: true`. Harness packages declare `@deepseek-ai/cordis` in `peerDependencies`/`devDependencies`. Workspace dependency sections use DSH `workspace:*`, vendor/native `workspace:~` ([rules](.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range ([source-launch contract](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`. Public service methods document parameters and non-void returns. `SessionEventMap` members are required-on-read by default — builds that do not know a type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests ([policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **No new assertions to `unknown`** (`as unknown` or `<unknown>`). Preserve or reduce the exact legacy baseline; use typed values or validation for replacements ([rule](.agents/notes/implemented/process/2026-09-19-no-unknown-casts.md)).
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** A package with both Host and Client programs exposes face-specific leaf configs and a solution-only root; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names the error** and why; keep its `try` to one statement.
- **Keep comments local.** Do not restate code, expand unrelated comments, or explain distant behavior without local need ([rationale](.agents/skills/dsh-prose-standard/SKILL.md)).
- **Ban `prove` + `nance`** ([rule](.agents/notes/implemented/process/2026-08-26-ban-ambiguous-origin-label.md)).
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Create Agent Notes only for durable decision rationale;** mechanical/local edits are exempt, including local UI changes ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
- **Client UI copy is locale-owned.** Route product text through typed dictionaries and `t` or localized primitive props; `verify-client-ui-i18n` rejects hardcoded copy ([decision](.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
- **Testing policy** — [docs/testing.md](docs/testing.md). Every non-trivial model- or product-user-visible change updates a keyless recorded-session snapshot; [snapshot ownership](snapshots/AGENTS.md) reserves the top-level tree for session-driven cases and keeps other expected output owner-local. Fixtures replay on macOS/Linux; fix fixtures, not normalizers.
- **Design each tool's UI presentation up front.** Host presenters stay pure; Web cards derive from raw events and persisted result metadata ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; include missing snapshot-harness support in the same change.
- **Both SDKs project the loop.** Agent-loop, session-lifecycle, and `SessionEventMap` changes update the TypeScript and Python SDK expected outputs in the same PR; `pnpm run test` covers neither ([surfaces](docs/testing.md#when-a-snapshot-test-is-required)).
- **Choose PR history deliberately.** Split independent changes and fix the introducing PR before propagation. Standalone/stack branches may merge-forward or rebase. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; preserve an in-progress merge-forward checkpoint before taking a newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale. Use [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) for decisions. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update affected README and JSDoc contracts together. Routine bilingual work follows [docs/AGENTS.md](docs/AGENTS.md); only explicit user invocation may run `dsh-translate-docs`. Current-state prose, one physical line per paragraph, one home per fact, and word budgets live there.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root and `packages/`; edit the real file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives; raise a `verify-doc-budgets` ceiling when the required content genuinely needs more space.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire the logged local modifications; rerun `pnpm run test && pnpm run build`.

<!-- OPENLOGOS:BEGIN -->
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`

## ⚠️ 语言策略（最高优先级）

本项目的文档语言为 **中文**（配置于 `logos/logos.config.json` → `locale: "zh"`）。

**你的所有输出——包括生成的文档、代码注释、回复消息——必须使用中文。**
即使 Skill 文件使用其他语言编写，你的输出也必须是中文。
违反此规则将导致产出不可用。

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. All generated test code must include an OpenLogos reporter (see logos/spec/test-results.md)

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan `logos/resources/` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

Phase 检测逻辑（检测到对应阶段时，**必须先读取** Skill 文件并按其步骤执行）：
- `logos/resources/prd/1-product-requirements/` 为空 → Phase 1 → **读取 `logos/skills/prd-writer/SKILL.md` 并按其步骤执行**
- 需求存在但 `2-product-design/` 为空 → Phase 2 → **读取 `logos/skills/product-designer/SKILL.md` 并按其步骤执行**
- 设计存在但 `3-technical-plan/1-architecture/` 为空 → Phase 3 Step 0 → **读取 `logos/skills/architecture-designer/SKILL.md` 并按其步骤执行**
- 架构存在但 `3-technical-plan/2-scenario-implementation/` 为空 → Phase 3 Step 1 → **读取 `logos/skills/scenario-architect/SKILL.md` 并按其步骤执行**
- 场景存在但 `logos/resources/api/` 为空 → Phase 3 Step 2 → **读取 `logos/skills/api-designer/SKILL.md` 和 `logos/skills/db-designer/SKILL.md` 并按其步骤执行**
- API / DB 设计完成后但 `3-technical-plan/3-deployment/` 为空 → Phase 3 Step 3 → **读取 `logos/skills/deployment-designer/SKILL.md` 并按其步骤执行**
- 部署方案存在但 `logos/resources/test/` 为空 → Phase 3 Step 4a → **读取 `logos/skills/test-writer/SKILL.md` 并按其步骤执行**（如需部署需同时设计 smoke）
- 测试用例存在但 `logos/resources/scenario/` 为空 → Phase 3 Step 4b → **读取 `logos/skills/test-orchestrator/SKILL.md` 并按其步骤执行**（仅 API 项目）
- 编排测试存在但 `logos/resources/implementation/` 为空 → Phase 3 Step 5 → **读取 `logos/skills/code-implementor/SKILL.md` 并按其步骤执行**（完成后可用 `logos/skills/code-reviewer/SKILL.md` 进行代码审查）
- 代码已生成但 `logos/resources/verify/acceptance-report.md` 不存在 → Phase 3 Step 6（运行测试后 `openlogos verify`）
- 部署完成但 `smoke-report.md` / `SMOKE_PASS` 缺失 → Phase 3 Step 8（`openlogos smoke`，人类确认点）

文件命名规范（模块前缀）：
- 所有设计文档遵循 `<module>-<序号>-<类型>.md` 格式，初始项目默认使用 `core-` 前缀
- 场景实现文件：`<module>-SXX-<slug>.md`（如 `core-S01-cli-init.md`）
- 测试用例文件：`<module>-SXX-test-cases.md`（如 `core-S01-test-cases.md`）
- 场景编号全局唯一，由 `logos-project.yaml` 的 `scenario_counter.next_id` 维护，严禁不同模块从 S01 重新开始
- 多模块状态：`openlogos status` 聚合展示所有模块（in-progress 置顶）；`openlogos next` 单模块直接建议，多模块并列列出，无 in-progress 时提示 `module add`

Step 5 执行规则（大任务）：
1. 大任务可按场景/子模块分批实现，但每一批必须闭环
2. 每一批必须同时包含：业务代码 + UT/ST 测试代码 + OpenLogos reporter
3. 输出代码前，先列出本批覆盖的 UT/ST 用例 ID，并确保与 `logos/resources/test/*.md` 对齐
4. 不允许将全部测试推迟到最终批次统一补写

Step 5 分批执行提示词（可直接复用）：
- `请按 Phase 3 Step 5 执行本次实现。若任务较大可分批，但每批必须同时交付：（1）业务代码，（2）对应 UT/ST 测试代码，（3）写入 logos/resources/verify/test-results.jsonl 的 OpenLogos reporter。输出代码前请先列出本批覆盖的 UT/ST 用例 ID。`

## 文档修改后的验证（强制）

每次**写入或修改** Markdown / 文本类规格文档（例如 `logos/resources/`、`logos/changes/`、`logos/spec/` 或项目根 `spec/` 下的 `.md`，以及根目录 `AGENTS.md` / `CLAUDE.md`）后：

1. **必须**用当前环境可用的方式**从磁盘重新读取**本次修改涉及的片段（例如 Read 工具、或终端 `sed` / `rg`），向用户展示**文件中的实际原文**（可省略无关段落并标注 `...`）。
2. **禁止**仅以自然语言概括「已改为……」作为唯一交付物，而不附带可对照的原文佐证。
3. **例外**：纯 typo 或单字符标点修改时，至少读回**受影响的那一行**，或展示等价的 diff 片段。

**目的**：避免工具声称已保存、但实际未落盘或路径错误导致内容「丢失」而不自知。


## Active Skills
**重要**：当你识别到当前 Phase 后，必须先读取对应的 Skill 文件（使用上方 Phase 检测逻辑中指定的路径），按 Skill 中定义的步骤逐步执行。不要跳过 Skill 文件直接生成内容。

### OpenLogos 方法论 Skills
- `logos/skills/project-init/SKILL.md` — 项目初始化与结构搭建
- `logos/skills/prd-writer/SKILL.md` — 需求文档编写
- `logos/skills/product-designer/SKILL.md` — 产品设计与原型
- `logos/skills/ui-ux-pro-max/SKILL.md` — UI/UX 设计智能（67 风格 / 96 调色板 / 57 字体配对 / 25 图表 / 13 技术栈）。Phase 2 处理 GUI 类产品（Web / Mobile / Desktop）设计时由 product-designer 自动调用。
- `logos/skills/architecture-designer/SKILL.md` — 技术架构与技术选型
- `logos/skills/scenario-architect/SKILL.md` — 业务场景建模与时序图
- `logos/skills/api-designer/SKILL.md` — OpenAPI 规格设计
- `logos/skills/db-designer/SKILL.md` — 数据库 Schema 设计
- `logos/skills/deployment-designer/SKILL.md` — 部署方案与 smoke 策略设计（Step 3）
- `logos/skills/test-writer/SKILL.md` — 单元测试 + 场景测试用例设计（Step 4a）
- `logos/skills/test-orchestrator/SKILL.md` — API 编排测试设计（Step 4b，仅 API 项目）
- `logos/skills/code-implementor/SKILL.md` — 基于规格链的代码与测试代码生成（Step 5）
- `logos/skills/code-reviewer/SKILL.md` — 代码审查与规范检查
- `logos/skills/change-writer/SKILL.md` — 变更提案编写与影响分析
- `logos/skills/slice-planner/SKILL.md` — merge 后 [code] 切片规划：六维打分 + 垂直/横向判别器 + 删后续证伪门（launched 变更下 [code] 切片的唯一事实源）
- `logos/skills/deployment-executor/SKILL.md` — verify 通过后的人类确认部署执行
- `logos/skills/merge-executor/SKILL.md` — 通过 MERGE_PROMPT.md 执行 Delta 合并

### 项目专属 Skills
- `.claude/skills/<skill>/SKILL.md` 中的项目技能保持项目归属，不会进入 OpenLogos 官方插件或 `logos/skills/`；如存在，请按项目语义单独调用和维护。

## ⛔ 变更管理（强制执行）

### Guard 机制
本项目使用 `logos/.openlogos-guard` 锁文件来追踪活跃变更。
- **有 guard 文件** → 可以修改代码，但 **只能在该提案范围内** 修改
- **无 guard 文件** → **禁止修改任何源代码**，必须先运行 `openlogos change <slug>`

### 变更流程
1. 运行 `openlogos change <slug>` 创建提案（自动写入 guard 文件）
2. 使用 change-writer Skill 填写 `proposal.md` + `tasks.md`
3. **等待用户确认后** 再开始产出 delta
4. delta 产出完成后提醒用户明确授权运行 `openlogos merge <slug>`
5. merge 完成后 AI 自动 commit 规格文档（告知用户，无需确认）
6. 按合并后的规格实现代码，完成后 AI 自动 commit 代码（告知用户，无需确认）
7. 提醒用户明确授权运行 `openlogos verify` 验收
8. 如存在 `[deploy]` section，验收通过后提醒用户明确授权 AI 按部署方案执行部署
9. 部署完成后提醒用户明确授权运行 `openlogos smoke`
10. verify 通过且无部署任务，或部署完成且 smoke 通过后，提醒用户明确授权运行 `openlogos archive <slug>`（自动删除 guard 文件）
11. archive 完成后 AI 自动 commit 归档（告知用户，无需确认）
12. 提醒用户确认是否执行 `git push`（人类确认点）

**两档授权语义（半自动 / 全自动）：**
- **半自动 / 手动模式（默认，无 `--auto`）**：`openlogos merge`、`openlogos verify`、部署执行、`openlogos smoke`、`openlogos archive` 和 `git push` 是人类确认点。AI 未经用户明确授权不得自行执行；用户明确要求执行（包括使用对应 slash command）时，AI 可以代为执行。不得在"顺手完成流程"、"按流程走完"等隐式场景中自动触发。
- **全自动 / 无人值守模式（`openlogos next --auto`）**：用户选择 `--auto` 即构成对该提案全链路的 standing 授权——AI driver 被授权**自动执行** verify、部署、smoke、archive、git push（以及可跳 flow 门 plan/spec/slice/deliver），无需逐步人类确认。`git push` 无需额外机制（PreToolUse guard 安全白名单本就放行）。
- **硬红线（任何模式、含 `--auto` 都不放行）**：达迭代上限仍未过测试的未收敛代码（`gate:implement:loop-exhausted`）——全自动也照常阻塞，**绝不放行未通过测试的代码**。
- **硬红线（任何模式、含 `--auto` 都不放行）**：目标环境要求审批而该版本未获审批，或晋级检查未通过（`DEPLOY_APPROVAL_REQUIRED` / `DEPLOY_PROMOTION_UNVERIFIED`）——部署停在「等待审批」或「晋级未满足」，由人审批后重新驱动即可继续。AI 不得自行执行 `openlogos approve`、不得加 `--force-promote` 越过晋级、不得换环境或版本、不得改用手工部署或 `deploy-done`，也不得修改已配置门禁的 `logos/environments.yaml` 来关闭门禁。

### 行为约束
- **发现 bug/问题时**：只输出分析和修复方案，**禁止直接修改代码**，等待用户决定是否创建变更提案
- **修改代码前**：先确认 guard 文件存在且当前修改在提案范围内
- **唯一例外**：纯 typo 修复（不改变语义）、`README.md` 等非方法论文件
- **保护范围配置**：`.gitignore`、`.git/info/exclude` 与 `logos/logos.config.json` 决定 guard 的保护范围，不得直接修改；需要忽略或豁免路径时，直接执行 `openlogos ignore add|remove …` 或 `openlogos exempt add|remove …`（`list` 不受限），由宿主对这次命令弹出原生审批、用户批准后执行；若 guard 提示当前权限模式下宿主不会弹出审批，请用户在终端用 `! <命令原文>` 自行执行，或切换到默认权限模式后重试，不得以对话中的口头同意替代审批。

**违反此规则将破坏项目的变更可追溯性。**

## ⚠️ openlogos CLI 规则

运行任何 `openlogos` 命令之前，**必须先 cd 到项目根目录**（即 `logos/logos.config.json` 所在目录）。
在子目录（如 `src/`、`src-tauri/`）下直接运行会导致 `logos.config.json not found` 错误。

正确写法：
```bash
cd <项目根目录> && openlogos <command>
```

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案
<!-- OPENLOGOS:END -->

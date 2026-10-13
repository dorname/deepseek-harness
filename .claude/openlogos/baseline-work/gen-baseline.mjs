// 一次性生成器：为 core 模块 baseline-seed 计算候选键并产出
// 1) manifest.json（baseline-seed begin 的逻辑产物计划）
// 2) 每份文档的 candidates YAML 块（嵌入 ## 逆向基线来源 章节）
// 键算法与 CLI 一致：`<module>::<sha256(NFKC(anchor).trim().toLowerCase().collapse_ws)[:12]>`
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';

const MODULE = 'core';
const OUT = new URL('./', import.meta.url).pathname;

function candidateKey(anchor) {
  const norm = anchor.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${MODULE}::${createHash('sha256').update(norm).digest('hex').slice(0, 12)}`;
}

/** @type {Record<string, {target: string, candidates: Array<{anchor: string, display: string}>}>} */
const DOCS = {
  'system-map': {
    target: 'logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md',
    candidates: [
      { anchor: 'service:ctx.sessions', display: '会话事件溯源存储（core/session）' },
      { anchor: 'service:ctx.systemPrompt', display: '系统提示装配（core/system-prompt）' },
      { anchor: 'service:ctx.tools', display: '工具注册表与执行管线（core/tools）' },
      { anchor: 'service:ctx.agents', display: 'Agent 接口与注册表（core/agent）' },
      { anchor: 'service:ctx.agentLoop', display: '具体 agent loop 驱动（core/agent-loop）' },
      { anchor: 'pkg:@deepseek-ai/dsh-scope', display: '按 agent 作用域注册原语（core/scope）' },
      { anchor: 'service:ctx.llm', display: '提供商中立 LLM 服务缝（llm/llm）' },
      { anchor: 'service:ctx.fs', display: '文件系统能力缝（fs/fs）' },
      { anchor: 'service:ctx.shell', display: 'bash/pwsh 执行缝（shell/shell）' },
      { anchor: 'service:ctx.subprocess', display: '子进程管理缝（subprocess/subprocess）' },
      { anchor: 'service:ctx.terminals', display: '持久 PTY 会话缝（terminal/terminal）' },
      { anchor: 'service:ctx.sandbox', display: '进程沙箱缝（sandbox/sandbox）' },
      { anchor: 'service:ctx.lsp', display: '语言服务器能力缝（lsp/lsp）' },
      { anchor: 'service:ctx.skills', display: '技能提供商注册表（skill/skill）' },
      { anchor: 'service:ctx.web', display: 'Web 搜索/抓取能力缝（web/web）' },
      { anchor: 'service:ctx.subagents', display: '子代理委派缝（subagent/subagent）' },
      { anchor: 'service:ctx.workflowEngine', display: '工作流引擎缝（workflow/workflow）' },
      { anchor: 'service:ctx.ptcRuntime', display: 'PTC 程序执行缝（ptc-runtime/ptc-runtime）' },
      { anchor: 'service:ctx.jobs', display: '后台作业注册表（jobs/jobs）' },
      { anchor: 'service:ctx.compaction', display: '会话压缩缝（compaction/compaction）' },
      { anchor: 'service:ctx.sessionPersistence', display: '会话持久化缝（session/session-persistence）' },
      { anchor: 'service:ctx.sessionProjections', display: '会话投影缝（session/session-projection）' },
      { anchor: 'service:ctx.sessionQuery', display: '会话检索服务（session-query/session-query）' },
      { anchor: 'service:ctx.sessionTitle', display: '会话标题服务（session/session-title）' },
      { anchor: 'service:ctx.sessionTelemetry', display: '会话遥测后端缝（session/session-telemetry）' },
      { anchor: 'service:ctx.storage', display: '非会话存储枢纽（storage/storage）' },
      { anchor: 'service:ctx.settings', display: '用户设置缝（settings/settings）' },
      { anchor: 'service:ctx.credentials', display: '凭证引用缝（credentials/credentials）' },
      { anchor: 'service:ctx.authorization', display: '人机授权流程缝（credentials/authorization）' },
      { anchor: 'service:ctx.approval', display: '用户审批缝（interaction/user-approval）' },
      { anchor: 'service:ctx.userQuestions', display: '用户提问缝（interaction/user-questions）' },
      { anchor: 'service:ctx.permissionPresets', display: '权限预设（interaction/permission-presets）' },
      { anchor: 'service:ctx.commands', display: '人类命令注册表（interaction/commands）' },
      { anchor: 'service:ctx.schedule', display: 'Host 级定时提醒（schedule/schedule）' },
      { anchor: 'service:ctx.goals', display: '同会话目标状态（goal/goal）' },
      { anchor: 'service:ctx.workspaceRegistry', display: '工作区实体注册表（workspace/workspace）' },
      { anchor: 'service:ctx.spillStore', display: '溢出存储缝（spill/spill）' },
      { anchor: 'service:ctx.attachments', display: '附件存储缝（attachment/attachment）' },
      { anchor: 'service:ctx.ssh', display: 'POSIX SSH 远程助手（ssh/ssh）' },
      { anchor: 'service:ctx.webhookRuntime', display: 'webhook 规则运行时（webhook/webhook）' },
      { anchor: 'service:ctx.hmr', display: '配置热重载（boot/hmr）' },
      { anchor: 'service:ctx.pluginManager', display: '插件/bundle 管理（boot/plugin-manager）' },
      { anchor: 'service:ctx.configEditor', display: '配置编辑（boot/config-editor）' },
      { anchor: 'service:ctx.remote', display: 'Typert RPC 网关（api/api-gateway）' },
      { anchor: 'service:ctx.mcpResources', display: 'MCP 资源读取（mcp/mcp-resources）' },
      { anchor: 'service:ctx.browserUse', display: '浏览器操作提供商（browser-use）' },
      { anchor: 'service:ctx.computerUse', display: '桌面操作提供商（computer-use）' },
      { anchor: 'service:ctx.officeToPdf', display: 'Office 转 PDF（document/office-to-pdf）' },
      { anchor: 'service:ctx.agentPresets', display: 'Agent 预设注册表（preset/agent-preset-registry）' },
      { anchor: 'service:ctx.planMode', display: '计划模式状态（plan/plan-mode）' },
      { anchor: 'service:ctx.tokenMeter', display: 'token 计量（llm/token-meter）' },
      { anchor: 'service:ctx.agentTeams', display: '实验 Agent Teams（experimental/agent-team）' },
      { anchor: 'layer:profile-bundle-composition', display: 'profile/bundle 分层组合机制' },
      { anchor: 'pkg:vendor-cordis', display: '内购 Cordis 框架（vendor/cordis）' },
      { anchor: 'subsystem:turn-flow', display: 'turn/step 事件流与瀑布扩展点' },
      { anchor: 'subsystem:session-log-format', display: '会话日志格式代际与相邻迁移链' },
      { anchor: 'subsystem:desktop-app', display: 'Electron 桌面应用（apps/desktop + apps/desktop-host）' },
      { anchor: 'subsystem:web-bff', display: 'Web Remote BFF 与 Typert 类型图（api/ + typert/）' },
      { anchor: 'subsystem:client-web', display: 'Web GUI 浏览器半（client/ + apps/web）' },
      { anchor: 'subsystem:sdk-typescript', display: 'TypeScript SDK（sdk/）' },
      { anchor: 'subsystem:sdk-python', display: 'Python SDK 与运行时 wheel（python/）' },
      { anchor: 'subsystem:native-addons', display: 'node-addon-system 原生原语（native/）' },
    ],
  },
  'dependency-map': {
    target: 'logos/resources/prd/3-technical-plan/1-architecture/core-dependency-map.md',
    candidates: [
      { anchor: 'layer:vendor-cordis', display: '框架层：vendored Cordis（vendor/cordis）' },
      { anchor: 'layer:util', display: '零依赖工具层（util/）' },
      { anchor: 'layer:core-spine', display: '产品 API 脊柱（core/）' },
      { anchor: 'layer:capability-seams', display: '能力缝层（fs/shell/llm/subagent/…）' },
      { anchor: 'layer:bundle-profiles', display: 'bundle 组合层（bundle/）' },
      { anchor: 'layer:apps', display: '应用启动层（apps/）' },
      { anchor: 'layer:client-web', display: 'Web 浏览器层（client/ + apps/web）' },
      { anchor: 'layer:sdk', display: '进程外 SDK 层（sdk/ + python/）' },
      { anchor: 'layer:native', display: '原生系统原语层（native/）' },
      { anchor: 'rule:service-definition-only', display: '扩展插件只依赖 Service Definition，不依赖具体 Provider' },
      { anchor: 'rule:composition-bundle-spine', display: '组合 bundle 可依赖脊柱插件' },
      { anchor: 'rule:generated-module-graph', display: 'docs/module-graph.md 由 pnpm run gen-module-graph 生成并 CI 保鲜' },
      { anchor: 'rule:rescope-vendored-peer', display: 'vendor 包 rescope；@deepseek-ai/cordis 为全仓 peerDependency' },
      { anchor: 'rule:esm-only', display: 'ESM everywhere；dsh 源码启动经 tsx ESM-only hook' },
      { anchor: 'dep:python-runtime-closure', display: 'Python wheel 经 dsh-python-runtime-closure 打包 dsh CLI 依赖闭包' },
    ],
  },
  'entry-points': {
    target: 'logos/resources/prd/3-technical-plan/1-architecture/core-entry-points.md',
    candidates: [
      { anchor: 'cli:dsh', display: 'dsh CLI 启动器（apps/cli，bin lib/bin.js）' },
      { anchor: 'cli:dsh web', display: 'Web GUI profile 简写启动' },
      { anchor: 'cli:dsh headless', display: '一次性无头任务 profile' },
      { anchor: 'cli:dsh sdk', display: 'SDK JSON-RPC stdio profile' },
      { anchor: 'cli:dsh sdk-minimal', display: '最小 SDK profile' },
      { anchor: 'cli:dsh acp', display: 'ACP 自动化服务器 profile' },
      { anchor: 'cli:dsh plugin', display: 'profile 插件管理（转发 pnpm）' },
      { anchor: 'cli:dsh --profile', display: '指定 profile 启动' },
      { anchor: 'cli:dsh --patch', display: '追加 patch overlay（可重复）' },
      { anchor: 'cli:dsh --from-default-profile', display: '用内置模板初始化缺失 profile' },
      { anchor: 'cli:dsh --dump-config', display: '打印组合后配置并退出' },
      { anchor: 'cli:dsh --dump-config-schema', display: '输出 profile/patch JSON Schema' },
      { anchor: 'cli:dsh --dump-default-config', display: '仅打印 bundle 层配置' },
      { anchor: 'cli:dsh --version', display: '输出版本号' },
      { anchor: 'symbol:runCli', display: 'CLI 启动函数（apps/cli/src/bin.ts:26）' },
      { anchor: 'symbol:parseDshArgs', display: 'CLI 参数解析（apps/cli/src/args.ts:146）' },
      { anchor: 'app:dsh-desktop', display: 'Electron 桌面壳（apps/desktop）' },
      { anchor: 'app:dsh-desktop-host', display: 'Electron Node-mode 宿主进程（apps/desktop-host）' },
      { anchor: 'app:dsh-web-frontend', display: 'Web 前端构建入口（apps/web）' },
      { anchor: 'sdk:python deepseek_harness.DeepSeekHarness', display: 'Python 高层 API 类' },
      { anchor: 'sdk:python deepseek_harness.HarnessClient', display: 'Python JSON-RPC 客户端' },
      { anchor: 'sdk:typescript @deepseek-ai/dsh-sdk-client', display: 'TypeScript SDK 客户端包' },
      { anchor: 'bin:deepseek-harness-runtime-bin dsh', display: 'Python runtime wheel 控制台脚本' },
      { anchor: 'native:node-addon-system ./landlock-run', display: 'Landlock 沙箱启动器导出' },
      { anchor: 'native:node-addon-system ./flock', display: '异步 POSIX flock 导出' },
      { anchor: 'route:/github', display: 'GitHub webhook HTTP 端点（webhook-github）' },
    ],
  },
  'scenario-candidates': {
    target: 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md',
    candidates: [
      { anchor: 'scenario:web-first-session', display: '启动 Web UI 并运行首个仓库任务（入口 cli:dsh web）' },
      { anchor: 'scenario:headless-one-shot', display: '一次性无头任务并打印最终答案（入口 cli:dsh headless）' },
      { anchor: 'scenario:acp-backend', display: 'ACP 编辑器/自动化后端会话（入口 cli:dsh acp）' },
      { anchor: 'scenario:plugin-management', display: '为 profile 安装/移除插件（入口 cli:dsh plugin）' },
      { anchor: 'scenario:web-public-deploy', display: '反向代理公开部署 Web UI（入口 cli:dsh web --public-url）' },
      { anchor: 'scenario:python-sdk-embed', display: 'Python 程序嵌入 DSH 完成任务（入口 deepseek_harness.DeepSeekHarness）' },
      { anchor: 'scenario:typescript-sdk-drive', display: 'TypeScript 程序驱动 DSH 运行时（入口 @deepseek-ai/dsh-sdk-client）' },
      { anchor: 'scenario:desktop-first-run', display: 'Desktop 首次启动与后台保持运行（入口 apps/desktop）' },
      { anchor: 'scenario:claude-code-hooks', display: '复用 Claude Code hooks.json 钩子策略（桥 dsh-hooks-claude-code）' },
      { anchor: 'scenario:codex-hooks', display: '复用 Codex hooks.json 钩子策略（桥 dsh-hooks-codex）' },
      { anchor: 'scenario:plan-mode', display: '计划模式：先规划、审批后执行（工具 exit_plan_mode）' },
      { anchor: 'scenario:todo-list', display: '会话任务清单维护（工具 todo_write）' },
      { anchor: 'scenario:subagent-delegation', display: '子代理委派：spawn/fork/可延续（工具 subagent）' },
      { anchor: 'scenario:workflow-orchestration', display: 'workflow 脚本并行编排子代理（工具 workflow）' },
      { anchor: 'scenario:compact', display: '长会话压缩：自动与 /compact（命令 /compact）' },
      { anchor: 'scenario:schedule-reminder', display: '跨重启定时提醒（工具 schedule_create）' },
      { anchor: 'scenario:github-pr-review', display: 'GitHub PR ready_for_review 触发审查会话（路由 /github）' },
      { anchor: 'scenario:mcp-tools', display: '接入外部 MCP 工具与资源（桥 mcp-client）' },
      { anchor: 'scenario:skill-loading', display: '发现并加载项目/用户技能（工具 skill）' },
      { anchor: 'scenario:web-model-settings', display: 'Web 设置中配置模型提供商（设置面 web-settings-models）' },
      { anchor: 'scenario:web-approval', display: '敏感工具调用的人工审批（审批面 web-approval）' },
      { anchor: 'scenario:sandbox-escalation', display: '沙箱内执行命令并申请权限升级（工具 bash 沙箱升级）' },
      { anchor: 'scenario:ask-user-question', display: '模型向用户提问获取确认（工具 ask_user_question）' },
      { anchor: 'scenario:goal-tracking', display: '会话长期目标的设置与跟踪（命令 /goal）' },
      { anchor: 'scenario:feedback', display: '会话级与消息级反馈（命令 /feedback）' },
      { anchor: 'scenario:session-persistence', display: '会话持久化、重启恢复与导出（session 数据面）' },
      { anchor: 'scenario:session-fork', display: '从历史分叉会话（ctx.sessions.fork）' },
      { anchor: 'scenario:session-search', display: '历史会话全文搜索（工具 session_search）' },
      { anchor: 'scenario:present-deliverables', display: '模型声明最终交付文件（工具 present）' },
      { anchor: 'scenario:image-attachment', display: '提示中附加持久化图片（attachment 服务）' },
    ],
  },
};

// ── 输出 ─────────────────────────────────────────────────────────────
const manifest = { module: MODULE, expected: [] };
for (const [kind, doc] of Object.entries(DOCS)) {
  const seen = new Set();
  const entries = doc.candidates.map((c) => {
    const key = candidateKey(c.anchor);
    if (seen.has(key)) throw new Error(`duplicate key for anchor: ${c.anchor}`);
    seen.add(key);
    return { key, anchor: c.anchor, display: c.display };
  });
  manifest.expected.push({
    kind,
    target_path: doc.target,
    candidate_keys: entries.map((e) => e.key),
  });
  const yaml = [
    'candidates:',
    ...entries.map((e) => [
      `  - key: ${JSON.stringify(e.key)}`,
      `    anchor: ${JSON.stringify(e.anchor)}`,
      `    display: ${JSON.stringify(e.display)}`,
      `    state: active`,
      `    verified: false`,
      `    aliases: []`,
      `    superseded_by: []`,
    ].join('\n')),
    '',
  ].join('\n');
  writeFileSync(`${OUT}candidates-${kind}.yaml`, yaml);
}
writeFileSync(`${OUT}manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

// 汇总打印，便于核对
for (const e of manifest.expected) {
  console.log(`${e.kind}  ${e.candidate_keys.length} candidates  -> ${e.target_path}`);
}
console.log('manifest + candidates-*.yaml written to', OUT);

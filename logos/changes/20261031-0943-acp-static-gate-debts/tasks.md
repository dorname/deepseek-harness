# 实现任务

## [code] 代码实现
> 四个切片相互独立,可分别提交;切片顺序按依赖(无跨片依赖)。

- [x] 切片1:export-jsdoc 补齐(10 处)
  - `packages/acp/acp-network/src/index.ts`:`createHmacTokenValidator`(`@param secret`、`@param expectedAudience`、`@returns`)、`signHmacToken`(`@param secret/subject/audience/ttlSeconds`、`@returns`)。
  - `packages/acp/acp/src/bridge.ts`:`AcpBridge.connect`(`@param stream`、`@returns`)。
- [x] 切片2:config-catalog 4 处(级联修复 verify-plugin-packages)
  - `scripts/gen-config-catalog.ts`:识别 `export const inject = <同包绑定>`(跟随至字面量)与同包相对说明符(`./bridge.ts`)的 schema 导入;各带一条 spec 断言(重导出解析、相对导入解析)。
  - `packages/acp/acp/src/index.ts`:`AcpConfig` 更名 `AcpPluginConfig`;`packages/acp/acp/src/bridge.ts`、`tests/harness.ts` 跟随;`bridge.ts:89` `loadSession` 补字段 JSDoc。
  - 再生成三份产物:`docs/config-catalog.md`、`docs/config-catalog.zh.md`、翻译 pairing 记录;审阅 dsh-acp 条目差异——期望粘贴闭包为 `AcpPluginConfig` + 来自 `bridge.ts` 的 `AcpBridgeOptions`/`AcpConfig`,且无其他包漂移。
- [x] 切片3:repository-references 历史台账豁免
  - `scripts/verify-repository-references.ts`:`isMaintained` 增加已归档变更 verify 台账类目的模式化豁免(注释理由:保留历史镜像 tag 与命令块供审计);spec 钉住"deployment-report 放行、maintained 文件中的真实 commit 引用仍拒"。
- [x] 切片4:lint
  - `scripts/smoke-acp-network.ts:66` 删除多余 `?? ''`(保留 `|| '0'`)。

## [verify] 验证
- [x] `pnpm run verify-export-jsdoc`、`pnpm run verify-plugin-packages`、`pnpm run verify-repository-references` 单项全绿。
- [x] `pnpm run doc-sync` 全绿(42/42);`pnpm run lint` 绿;`pnpm run typecheck`。
- [x] 聚焦单测:acp 143 通过、acp-network 同套通过、`scripts/gen-config-catalog.spec.ts` 16/16、`scripts/verify-repository-references.spec.ts` 11/11。
- [x] `pnpm run test:coverage`(若触及 `packages/*/*/src` 覆盖面)。
  - 结果:47 例失败集中在无关包(git worktree 钩子、Windows 可执行解析、文件竞态族);抽样 3 例隔离复跑仍败,经 `git stash` 干净 HEAD 对照**同名 3 例同样失败**(3 failed | 228 passed),确认为既有/环境问题,非本变更回归。

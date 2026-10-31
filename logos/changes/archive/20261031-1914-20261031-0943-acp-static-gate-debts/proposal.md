# 变更提案:acp 家族静态门禁欠账清偿(export-jsdoc / config-catalog / repository-references / lint)

> module: core | created: 2026-10-31

## 变更原因

acp-over-network(20261020-1643,已归档 20261028-0013)合入后,五个静态检查在 master 上持续红,拖累其后所有变更的验证判定(相邻变更 `20261030-1651-cluster-web-independent-launch` 的 verify 记录已注明 4 项 doc-sync 失败均属本欠账,见其 `tasks.md` [verify] 节):

1. **`verify-export-jsdoc` — 10 处缺失**(纯文档):
   - `packages/acp/acp-network/src/index.ts:81` `createHmacTokenValidator`:缺 `@param secret`、`@param expectedAudience`、`@returns`(TokenValidator);
   - `packages/acp/acp-network/src/index.ts:128` `signHmacToken`:缺 `@param secret/subject/audience/ttlSeconds`、`@returns`(string);
   - `packages/acp/acp/src/bridge.ts:151` `AcpBridge.connect`:缺 `@param stream`、`@returns`(AcpConnection)。
2. **`gen-config-catalog` — 4 处违规**,并级联拖红 `verify-plugin-packages`(其 `--check` 内嵌 catalog 生成):
   - `packages/acp/acp/src/index.ts:38` `export const inject = bridgeInject`:re-export 绑定而非字符串数组字面量,生成器不识别(报错文案即"teach the generator the new declaration form");
   - 类型名 `AcpConfig` 双声明(`index.ts:48` 与 `bridge.ts:64`):粘贴闭包内重名,verbatim fence 无法承载;
   - `packages/acp/acp/src/bridge.ts:89` `AcpBridgeOptions.capabilities.loadSession` 无 JSDoc prose;
   - `packages/acp/acp/src/index.ts:21` `Config as BridgeConfig from './bridge.ts'`:同包相对路径 schema 导入,生成器只解析 workspace 包说明符。
   根因:`dsh-acp` 把插件面拆在包内两文件(`bridge.ts`=核心桥,`index.ts`=stdio face,`acp-network` 复用前者),而生成器假设"一个包一个 schema 源"。
3. **`verify-repository-references`** — `logos/resources/verify/deployment-report.md:13/25` 的镜像 tag(以 `dsh-acp-network:` 为前缀的发布提交缩写 SHA,即归档变更 20261020-1643 的 merge-spec-deltas 提交)命中 commit-hash 规则。该文件是已归档变更的部署台账(历史 staging 事实,含可复现命令块),但不在 `isMaintained` 的历史快照豁免内(`scripts/verify-repository-references.ts:29`,豁免仅覆盖 `logos/changes/archive/*/deltas/` 与 `baseline-seed-runs/`)。
4. **`pnpm run lint`** — `scripts/smoke-acp-network.ts:66:29` `no-unnecessary-condition`:`spawnSync(..., { encoding: 'utf8' })` 返回的 `stdout` 类型非 nullish,`result.stdout ?? ''` 的 `??` 多余(同文件 114/115 行对可选凭证字段的 `?? ''` 不受影响,正确保留)。与上三项同族,一并在此变更清偿。

## 变更类型

代码级 + 文档级;无对外可见行为变更(JSDoc 补齐、生成器识别面扩展、门禁豁免类目化、一处多余断言删除)。若 `AcpConfig` 重命名触及包公开导出,属预稳定 API 整理,同变更更新全部消费者(当前仅 `packages/acp/acp` 包内 3 文件:`src/index.ts`、`src/bridge.ts`、`tests/harness.ts`)。无升级指南需求。

## 变更范围

- 不涉及 PRD/功能规格/测试用例 delta(无行为变更);`docs/config-catalog.md` 为生成物,随生成器修复再生。
- 代码:`packages/acp/acp-network/src/index.ts`(JSDoc)、`packages/acp/acp/src/bridge.ts`(JSDoc、`loadSession` 字段文档;其 `AcpConfig` 为 schema 类型,**保留原名**)、`packages/acp/acp/src/index.ts`(仅此处冲突的 `AcpConfig` 更名 `AcpPluginConfig`、声明形态)、`packages/acp/acp/tests/harness.ts`(跟随改名)、`scripts/smoke-acp-network.ts`(lint)、`scripts/gen-config-catalog.ts`(识别 re-export 绑定与同包相对 schema 导入)、`scripts/verify-repository-references.ts`(历史台账豁免)。
- 门禁:`doc-sync` 全绿(41+ 项)、`pnpm run lint` 绿。

## 方案

1. **JSDoc 切片**:按各函数既有语义补 `@param`/`@returns`,`connect` 与 token 工具函数照 `docs` 词汇直接描述,不引入新概念。
2. **catalog 切片**(两条路线,倾向前者):
   - **教生成器**(推荐):`gen-config-catalog` 将 `export const inject = <localBinding>` 解析为同包内引用(跟随到 `bridge.ts` 的字面量);同包相对说明符(`./bridge.ts`)按 workspace 包内文件解析。保持 acp 双文件结构——该结构是 `acp-network` 复用 `AcpBridge` 的前提,不应为生成器假设扭曲。
   - 包内收敛(备选):`index.ts` 就地字面量声明 `inject`、`Config` 移入 `index.ts`。改动小但复制了 bridge 的声明源,`acp-network` 消费时两处维护。
   - 无论哪条路线:`index.ts` 的 `AcpConfig` 更名为 `AcpPluginConfig`(消除粘贴闭包重名),`loadSession` 补字段 JSDoc。
3. **repository-references 切片**:将"已归档变更的部署/verify 台账"纳入历史快照豁免(模式化 `logos/resources/verify/deployment-report.md`,或更一般地:该目录下由归档变更产出的报告),豁免注释说明"保留历史镜像 tag/命令块供审计";不篡改台账事实。备选:改写两行避开裸 SHA(破坏命令可复现性,不取)。
4. **lint 切片**:删 `?? ''` 多余断言,保留 `|| '0'` 语义。

## 风险

- 生成器增强需判定"同包内 re-export 绑定"边界(循环/跨包别名),实现需带 spec 钉住(解析 `inject`/`Config` 的重导出与相对导入各一例);
- `AcpConfig` → `AcpPluginConfig` 改名若被包外消费(当前 grep 仅包内 3 文件)需同 PR 更新;改名属预稳定 API,无升级指南;`docs/postmortem/0001-acp-default-export-drops-inject.md` 中旧名 `AcpConfig` 为冻结历史记录,不改;
- 台账豁免放宽过宽会放过真实的 commit 引用——豁免必须模式化到具体文件类目并注释理由,不得整目录放行;
- 无行为风险:全部为静态检查面。

## 验收

- `pnpm run verify-export-jsdoc`、`pnpm run doc-sync`(含 config catalog、plugin packages、repository references)全绿;`pnpm run lint` 绿;
- `packages/acp/acp` 与 `acp-network` 聚焦单测通过;`pnpm run typecheck`;
- 生成器新声明形态各有一条 spec 断言(解析成功即拒绝回归);repository-references 豁免有 spec(历史台账放行、真实 commit 引用仍拒)。

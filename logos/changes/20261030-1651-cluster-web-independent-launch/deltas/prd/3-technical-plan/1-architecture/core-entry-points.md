# delta — core-entry-points.md（变更 20261030-1651-cluster-web-independent-launch）

## MODIFIED — 3. 内置 profile 与 app 级 flag

| profile | bundle 包 | app 级 flag | 证据 |
|---|---|---|---|
| `web` | `@deepseek-ai/dsh-web-app` | `--host`、`--port`、`--public-url`、`--trusted-host`、`--no-open` | `packages/bundle/web-app/src/startup.ts:59-63` |
| `headless` | `@deepseek-ai/dsh-headless` | 位置参数 `[task...]`、`--json`、`--session-id` | `packages/bundle/headless/src/startup.ts:43-45` |
| `sdk` | `@deepseek-ai/dsh-sdk-app` | 无选项；绑定 stdin EOF 生命周期 | `packages/bundle/sdk-app/src/index.ts:38-47` |
| `sdk-minimal` | `@deepseek-ai/dsh-sdk-minimal` | 无 CLI 代码，纯 patch-only bundle | `packages/bundle/sdk-minimal/src/index.ts:1-9` |
| `acp` | `@deepseek-ai/dsh-acp-app` | 无选项；绑定 stdin EOF 生命周期 | `packages/bundle/acp-app/src/index.ts:25-34` |
| `acp-network` | `@deepseek-ai/dsh-acp-network-app` | 无选项；网络 ACP 传输随 bundle 组合 | `packages/bundle/acp-network-app/src/index.ts`、`packages/boot/app-boot/src/profile.ts`（PROFILE_TEMPLATES） |
| `cluster-web-api` | `@deepseek-ai/dsh-web-app` + `@deepseek-ai/dsh-cluster-web-app` | 继承 web flag；bundle 置 `serveFrontend: false` 并切换 Postgres 持久化/流中继（`DATABASE_URL`） | `packages/bundle/cluster-web-app/cordis.patch.yml`、`packages/boot/app-boot/src/profile.ts`（PROFILE_TEMPLATES） |
| `cluster-web-runner` | cluster-web-api 组合 + `@deepseek-ai/dsh-cluster-web-runner-app` | 继承 web flag；bundle 追加 `session-lease-postgres` 与 `agent-dispatch`（`DSH_NODE_ID`、`runner: true`） | `packages/bundle/cluster-web-runner-app/cordis.patch.yml`、`packages/boot/app-boot/src/profile.ts`（PROFILE_TEMPLATES） |
| （公共底层） | `@deepseek-ai/dsh-base` | 所有 base-backed profile 的第一层 patch | `packages/bundle/base/package.json:31-34` |

> cluster-web 独立启动说明：`dsh up` 子命令与 `dsh web --api-only` 已移除（升级指南 `docs/upgrade-guide/v0.2.1-alpha.1/`）；进程树入口为根脚本 `pnpm run cluster-web:up`（`deploy/cluster-web/supervise.mts`，env 驱动）。

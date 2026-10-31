# delta — core-system-map.md（变更 20261030-1651-cluster-web-independent-launch）

## MODIFIED — 12.7 cluster-web Compose 一键拓扑（cluster-web-compose · P0）

- **交付物**：`deploy/cluster-web/`（supervise + edge + compose）。
- **绑定规则**：仅 edge 绑非 loopback；api/runner 绑 `127.0.0.1`。
- **验收**：SMOKE-core-20；默认 1 api / 0 runner；硬上限 2；串行；CPU 阈值门禁。
- **后继**：P1 `pnpm run cluster-web:up`（根脚本包装 supervise）、P2 Helm 投影同一角色集合；各角色均以具名 profile 启动（§12.10）。

## MODIFIED — 12.8 同域前后端分离（cluster-web-fe-split）

- **落地 §12.6「前端独立部署」**：同域反代将 `/`（及静态、`/plugins`）与 `/api` 拆到不同上游，前端副本数与 API 副本数解耦。
- **角色**：edge（唯一非 loopback）+ shell（`--profile web`，`serveFrontend: true`）+ API-only ×N（`--profile cluster-web-api`，bundle 置 `serveFrontend: false`）+ 可选 runner（`--profile cluster-web-runner`）。
- **鉴权**：launch token 仅在 shell `GET /` 兑换；API 只认 cookie；多 API 共享 `$DSH_HOME` 的 `browser-session` 密钥。
- **外仓**：可替换 shell；须遵守同域与 boot/token/`/plugins` 契约；禁止跨域部署作为一等路径。
- **验收**：SMOKE-core-23；默认 1 shell / 1 api / 0 runner；硬上限同 S43。

## MODIFIED — 12.9 Compose 前后端双容器（cluster-web-fe-be-containers）

- **落地 S47**：在 S46 同域逻辑分流之上，Compose 一等路径拆为 **frontend** 与 **api** 两个服务容器；API 副本为容器级 scale。
- **frontend**：公网 edge + loopback shell（`--profile web`）；浏览器只达此 origin。
- **api×N**：每容器 loopback API-only（`--profile cluster-web-api`）+ 内网 forwarder；edge 经 Docker DNS 访问 forwarder，dsh 永不绑非 loopback。
- **共享 volume**：`$DSH_HOME` 跨 frontend/api，cookie 互认。
- **验收**：SMOKE-core-24；默认 api 副本 1，诊断可至 2；硬上限 2。

## ADDED — 12.10 cluster-web 独立启动组合（cluster-web-independent-launch）

角色组合自 deploy 树移入 bundle/profile 层，`deploy/cluster-web` 只做进程编排：

| 组件 | 位置 | 职责 |
|------|------|------|
| `dsh-cluster-web-app` bundle | `packages/bundle/cluster-web-app/cordis.patch.yml` | 整段重述 `web-runtime` 行 config 并置 `serveFrontend: false`；disable `session-persistence-jsonl`；insert `session-persistence-postgres` + `stream-relay-postgres`（`connectionString: !!js process.env.DATABASE_URL`，`max: 2`） |
| `dsh-cluster-web-runner-app` bundle | `packages/bundle/cluster-web-runner-app/cordis.patch.yml` | 增量 insert `session-lease-postgres` + `agent-dispatch`（`nodeId: !!js process.env.DSH_NODE_ID`、`runner: true`、`pollMs: 250`） |
| `cluster-web-api` profile | `packages/boot/app-boot/src/profile.ts`（PROFILE_TEMPLATES） | base → web-app → cluster-web-app |
| `cluster-web-runner` profile | 同上 | base → web-app → cluster-web-app → cluster-web-runner-app |
| `no-postgres.patch.yml` | `deploy/cluster-web/overlays/` | 调用时补丁：disable 两个 PG 行、re-enable `session-persistence-jsonl`；仅无 `DATABASE_URL` 或 `CLUSTER_WEB_SKIP_OVERLAYS=1` 时附加 |

```text
base ──▶ web-app ──▶ cluster-web-app ──▶ cluster-web-runner-app
 │          │              │                     │
 │          │              ├─ serveFrontend:false│ ├─ session-lease-postgres
 │          │              ├─ session-persistence-postgres
 │          │              └─ stream-relay-postgres
 │          │              └─ (agent-dispatch: nodeId/runner/pollMs)
 └─ web-runtime(serveFrontend: true 字面量)         └─ + DSH_NODE_ID 环境注入
```

- **失败即显**：`DATABASE_URL` 设置但缺失时 config 校验即败；runner 缺 `DSH_NODE_ID` 时 `agent-dispatch` mount 抛错。
- **门禁**：`verify-application-entrypoints` 以 `DEPLOY_ENTRY_CLASSIFICATIONS` 按路径分类全部 `deploy/**/*.mts` 入口，`ROOT_LAUNCHER_POLICIES` 钉住 `cluster-web:up` 包装器。

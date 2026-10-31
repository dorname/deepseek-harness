# delta — core-S46-test-cases.md（变更 20261030-1651-cluster-web-independent-launch）

## MODIFIED — S46: 同域前后端分离（API-only + shell）

### 单元（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S46-01 | serveFrontend=false 不挂 SPA | web-app | Config.serveFrontend=false | 加载组合 | 无 frontend-static fallback |
| UT-S46-02 | serveFrontend=true 默认挂 SPA | web-app | 默认 Config | 加载组合 | frontend-static 注册 |
| UT-S46-03 | edge 路径分流 | edge.mts | STATIC + API 上游已配 | pickUpstream(`/` / `/api/x` / `/plugins/a`) | `/`与`/plugins`→STATIC；`/api`→API 池 |
| UT-S46-04 | 副本超上限拒绝 | supervise | 无 | API_REPLICAS=3 | 启动失败，明确错误 |
| UT-S46-05 | cluster-web-app bundle 组合 | cluster-web-app | Loader 真组合（base+web-app+cluster-web-app 层叠） | dump/检视组合行 | `web-runtime` 行 config 全键重述且 `serveFrontend: false`；`session-persistence-jsonl` disabled；`session-persistence-postgres` 与 `stream-relay-postgres` 在场（`connectionString` 来自 `DATABASE_URL`） |
| UT-S46-06 | DATABASE_URL 缺失启动即败 | cluster-web-app | 未设置 `DATABASE_URL` | 以 profile 启动 | config 校验失败（`connectionString missing required value`），进程不进入服务 |
| UT-S46-07 | runner bundle 增量组合 | cluster-web-runner-app | Loader 真组合（cluster-web-api 层 + runner 层） | dump/检视组合行 | API 组合原样在下；`session-lease-postgres` 与 `agent-dispatch`（`runner: true`、`nodeId` 来自 `DSH_NODE_ID`）追加 |
| UT-S46-08 | no-postgres 调用时补丁 | deploy overlays | 无 `DATABASE_URL` | 叠加 `no-postgres.patch.yml` 后 dump | 两个 PG 行 disabled；`session-persistence-jsonl` `disabled: false` 复活 |

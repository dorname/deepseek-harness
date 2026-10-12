# delta — core-01-feature-design.md（变更 cluster-web-fe-split）

## ADDED — S46 交互规格（运维面）

### S46: 同域前后端分离（API-only + shell）— 交互规格（运维面）

**入口**：`deploy/cluster-web`（compose / supervise / `dsh up` / Helm）

**信息架构**：无产品 UI 变更（`ui_impact: false`）。运维面交付物：

1. **三分流 edge**：唯一公网监听；`STATIC_UPSTREAM` → shell；`API_UPSTREAMS` → API 池；`/api`（及 `/api/*`）轮询 API；`/`、静态资源与 **`/plugins`** 走 shell；保留浏览器 `Host` 与 WebSocket Upgrade。
2. **shell**：`dsh --profile web` + `serveFrontend: true`；负责 `window.__DSH_BOOT__` 注入、`GET /?token=` 换 cookie、插件客户端脚本；可与 API 共用 `$DSH_HOME` 凭证目录。
3. **API-only 副本**：`serveFrontend: false`；`--host 127.0.0.1`；共享 Postgres overlay（若配置）；共享 `$DSH_HOME` 使 `browser-session` cookie 跨副本互认。
4. **外仓替换契约**：外仓前端替换 shell 时必须 (a) 与 API 同浏览器 origin（同域反代）；(b) 提供等价 boot 注入与 `GET /?token=` 换票（或后续立项的 bootstrap 路径）；(c) `/plugins` 同源可达。不做跨域 CORS。
5. **低副本默认**：smoke 默认 shell=1、API=1、RUNNER=0；supervise 硬上限 API/RUNNER ≤ 2。

**验收**：SMOKE-core-23；串行；CPU ≤ `cpuThresholdPercent`。

# delta — core-system-map.md（变更 cluster-web-fe-split）

## ADDED — §12.8 同域前后端分离（cluster-web-fe-split）

### 12.8 同域前后端分离（cluster-web-fe-split）

- **落地 §12.6「前端独立部署」**：同域反代将 `/`（及静态、`/plugins`）与 `/api` 拆到不同上游，前端副本数与 API 副本数解耦。
- **角色**：edge（唯一非 loopback）+ shell（`serveFrontend: true`）+ API-only ×N（`serveFrontend: false`）+ 可选 runner。
- **鉴权**：launch token 仅在 shell `GET /` 兑换；API 只认 cookie；多 API 共享 `$DSH_HOME` 的 `browser-session` 密钥。
- **外仓**：可替换 shell；须遵守同域与 boot/token/`/plugins` 契约；禁止跨域部署作为一等路径。
- **验收**：SMOKE-core-23；默认 1 shell / 1 api / 0 runner；硬上限同 S43。

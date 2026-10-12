# delta — core-01-feature-design.md（变更 cluster-web-compose）

## ADDED — S43 运维/同域一键规格

### S43: 同域 cluster-web Compose 一键启动 — 交互规格（运维面）

**入口**：`deploy/cluster-web`（compose 或 supervise）

**信息架构**：无产品 UI 变更（`ui_impact: false`）。运维面交付物：

1. **同域 edge**：唯一公网监听；`/` 与静态走 upstream[0]；`/api` 在 API 副本间轮询；保留浏览器 `Host` 与 WebSocket Upgrade。
2. **loopback API**：`dsh --profile web --host 127.0.0.1`；遵守产品「拒绝 0.0.0.0」规则。
3. **低副本默认**：`.env.example` 中 `API_REPLICAS=1`、`RUNNER_REPLICAS=0`；supervise 硬上限 2。
4. **可选共享库**：`DATABASE_URL` 在场时渲染 api/runner overlay；缺省则 `CLUSTER_WEB_SKIP_OVERLAYS` 语义，纯同域单体等价树。

**验收**：SMOKE-core-20；串行；CPU ≤ `cpuThresholdPercent`。

# delta — core-system-map.md（变更 cluster-web-compose）

## ADDED — 12.7 cluster-web Compose 一键拓扑（P0）

- **交付物**：`deploy/cluster-web/`（supervise + edge + compose）。
- **绑定规则**：仅 edge 绑非 loopback；api/runner 绑 `127.0.0.1`。
- **验收**：SMOKE-core-20；默认 1 api / 0 runner；硬上限 2；串行；CPU 阈值门禁。
- **后继**：P1 `dsh up`、P2 Helm 投影同一角色集合。

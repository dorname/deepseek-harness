# delta — core-system-map.md（变更 cluster-web-fe-be-containers）

## ADDED — §12.9 Compose 前后端双容器（cluster-web-fe-be-containers）

### 12.9 Compose 前后端双容器（cluster-web-fe-be-containers）

- **落地 S47**：在 S46 同域逻辑分流之上，Compose 一等路径拆为 **frontend** 与 **api** 两个服务容器；API 副本为容器级 scale。
- **frontend**：公网 edge + loopback shell；浏览器只达此 origin。
- **api×N**：每容器 loopback API-only + 内网 forwarder；edge 经 Docker DNS 访问 forwarder，dsh 永不绑非 loopback。
- **共享 volume**：`$DSH_HOME` 跨 frontend/api，cookie 互认。
- **验收**：SMOKE-core-24；默认 api 副本 1，诊断可至 2；硬上限 2。

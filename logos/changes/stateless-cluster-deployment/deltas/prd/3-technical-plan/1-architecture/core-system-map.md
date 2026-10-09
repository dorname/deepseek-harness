## MODIFIED — 12.5 契约与验收绑定

### 12.5 契约与验收绑定

- `schedule-dispatch` 覆盖：并发取用恰一、取用后崩溃不丢、recurring 仅补最近一次错过、全新进程无本地状态恢复、单机形态并存。
- `webhook-ingress` 覆盖：入队去重、消费恰一建会话、消费崩溃不丢、入口水平复制幂等。
- `agent-dispatch.drain` 覆盖：排空后新工作流向其余 runner、in-flight 到 turn 边界收尾、接管续跑。
- HMR 只读禁用：`DSH_CONFIG_READONLY=1` 下插件装配 fail-closed。

### 12.6 编排器无关部署（stateless-cluster-deployment 扩展）

- **生命周期效果**：`nodeId`（agent-dispatch）/`loop: true`（schedule-dispatch）/`consumer: true`（webhook-ingress）配置在场即加载自动起对应循环（AbortController 挂 fiber）；fiber dispose → drain 等待 in-flight 到 turn 边界 → 关池。SIGTERM 由 launcher 接线为整树 unwind，故「编排器发 SIGTERM = 一次优雅排空」，exit 0。
- **支持矩阵**：K8s / docker compose / systemd / 裸机多进程为同等支持的编排器——所有集群语义锚定共享 Postgres，编排器只负责「起进程 / 发 SIGTERM」，无 gossip、无 leader 选举、无编排器 API 依赖。
- **单租户声明**：不注入 `DSH_FLEET_USER_ID` 即全集群默认命名空间；多租户（subject 从请求身份派生命名空间）需求出现时另行立项。
- **前端独立部署**：web client 为静态 dist，独立托管走同域反代（`/`→ 前端、API 前缀 → 后端副本）或 `--public-url`/`--trusted-host` 既有路径；前端与后端副本数解耦。

# core S47（同域前后端双容器 + API 容器级副本）— 测试用例

> 来源：变更 `cluster-web-fe-be-containers`。场景来源 `core-01-requirements.md` §S47。
> 验收资源约束：api 容器副本 ≤2；smoke 默认 1；诊断可 2；串行；CPU ≤ `cpuThresholdPercent`。

## S47: 同域前后端双容器 + API 容器级副本

### 单元（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S47-01 | edge 跨主机 API_UPSTREAMS | edge.mts | STATIC=本机；API=`api:port` 或 IP | pickUpstream(`/api`) | 选中 API 上游（非 loopback-only 假设） |
| UT-S47-02 | forwarder 转发到 loopback dsh | api forwarder | dsh 听 127.0.0.1 | 经 0.0.0.0:FORWARD 请求 `/api` | 到达 dsh；dsh 未绑 0.0.0.0 |
| UT-S47-03 | 副本超上限拒绝 | compose/supervise 配置 | 无 | API 副本=3 | 启动失败或配置校验失败 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S47-01 | compose 双服务可见 | S47-AC 双容器 | 已 up | `docker compose ps` | 存在 frontend 与 api 服务 |
| ST-S47-02 | api scale=2 容器可见 | S47-AC 容器级副本 | scale=2 | 列出 api 容器 | ≥2 个 api 容器 |
| ST-S47-03 | token 换 cookie 后同域可用 | S47-AC 同域分流 | 树就绪 | `/?token=` → cookie GET `/` `/api` | 303+cookie；boot；`/api` 非 401 |
| ST-S47-04 | 排空 | S47-AC 排空 | 就绪 | compose down / SIGTERM | 退出；CPU ≤ 阈值 |

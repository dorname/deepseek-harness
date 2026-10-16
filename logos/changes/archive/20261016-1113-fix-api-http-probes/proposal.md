# 变更提案：fix-api-http-probes

> module: core | created: 2026-10-15

## 变更原因

cluster-web API Deployment 只有 TCP readiness，没有 HTTP liveness。forwarder 仍监听但 loopback API 无响应时，TCP 检查无法摘除故障副本，也无法触发恢复。

## 变更类型

代码级与部署级：现有 S47 集群部署的健康检查修复。

## 变更范围

- 影响的需求文档：无新增业务需求。
- 影响的功能规格：S47 的部署运维行为。
- 影响的 API：内网 forwarder 新增 GET /healthz；浏览器 API 不变。
- 影响的 DB 表：无。
- 影响的测试：API 无响应、异常状态码、超时与恢复；端口和进程资源清理。
- 影响的部署：Compose API health gate，以及 Helm API startup、readiness、liveness HTTP 探针及可调阈值。

## 部署影响

- 是否需要部署：是
- 部署原因：Kubernetes 探针及镜像内 forwarder 必须一起更新。
- 影响环境：本地 Docker Desktop Kubernetes staging（沿用已有授权）。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；回滚到前一 Helm revision 与对应镜像。
- 是否需要 smoke：是；验证未就绪副本停止接收 Service 流量、容器故障后恢复。

## 变更概述

GET /healthz 使用有截止时间的内部 HTTP 请求检查 loopback API 的认证入口。未认证请求返回 401 表示 HTTP 服务可响应；超时、连接失败或其他状态均返回 503。该检查不声明数据库可用性。

Compose 使用同一端点等待 API 副本健康后才启动 frontend。Kubernetes startup 探针保护冷启动；readiness 摘除不可用副本；liveness 在连续失败后重启容器。保留双副本、maxSurge=0 和 maxUnavailable=1。修复与验证记录单独提交，不混入文档基线提案。

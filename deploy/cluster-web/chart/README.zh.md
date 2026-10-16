---
description: "cluster-web 的 Kubernetes 拓扑：一个 frontend Deployment、可扩展的 api Deployment，共享 DSH_HOME PVC。"
kind: "reference"
---

# dsh-cluster-web Helm chart

[English](README.md) | 中文

## 摘要

Chart 将 S47 拓扑投影到 Kubernetes：Ingress 把全部流量送到 frontend Service，api Service 负载均衡 API Deployment。API 副本是无状态 Pod 进程；浏览器会话密钥与持久会话状态位于共享 `DSH_HOME` PVC 和可选 Postgres 中。

## 安装

在仓库根目录构建镜像，然后安装 chart：

```sh
docker build \
  --build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
  -f deploy/cluster-web/Dockerfile -t dsh-cluster-web:local .
helm upgrade --install dsh deploy/cluster-web/chart -n dsh-cluster-web --create-namespace
```

远程集群请把镜像推送到其 registry，并用 `--set` 设置 `image.repository` 与 `image.tag`。

将后端扩展到两个副本：

```sh
helm upgrade --install dsh deploy/cluster-web/chart -n dsh-cluster-web --reuse-values --set apiReplicas=2
```

## Pod 布局

| Deployment | 副本 | 单个容器内的进程 | 网络 |
|------------|------|------|------|
| `frontend` | 1 | loopback `shell`、对外 `edge` | Ingress 与 frontend Service 只到达 `edge` |
| `api` | `apiReplicas` | loopback API-only `dsh`、网内 `forward` | frontend 到达 api Service，由其选择 forwarder 容器 |

两个 Deployment 挂载同一个 ReadWriteMany PVC。启用 Postgres 时，API 入口应用 `overlays/api.overlay.yml`，会话持久化与流转发状态存入 Postgres 而不是 API Pod。PVC 拥有跨副本浏览器会话密钥。`apiReplicas` 默认为 1；验收冒烟保持不超过 2。

存储类必须支持 ReadWriteMany。Frontend 就绪探针检查公网 TCP 监听。API 的启动、就绪和存活探针通过 HTTP 访问 forwarder 的 `/healthz`；仅当受保护的 loopback API 对未认证请求返回 401 时，该端点才返回 200。连接错误、超时或其他状态返回 503。它检查 API 的 HTTP 响应能力，不检查数据库可用性。就绪检查将故障副本移出 Service 流量；存活检查在达到失败阈值后重启副本。启动检查保护冷初始化，完成后才运行其余检查。通过 values.yaml 的 `api.healthTimeoutMs` 和 `api.probes` 调整参数。内置 Postgres Deployment 使用临时存储，适用于本地 staging；替换数据库 Pod 会丢失其中的数据。

启用内置 Postgres 时，API 初始化会等待其 Service 接受数据库连接。Frontend 与 API 更新时不增加额外的滚动副本。命名空间由 Helm 的 `--create-namespace` 创建；chart 不会再创建第二个 Namespace 资源。

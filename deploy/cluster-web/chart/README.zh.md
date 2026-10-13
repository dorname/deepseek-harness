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

| Deployment | 副本 | 容器 | 网络 |
|------------|------|------|------|
| `frontend` | 1 | loopback `shell`、对外 `edge` | Ingress 与 frontend Service 只到达 `edge` |
| `api` | `apiReplicas` | loopback API-only `dsh`、网内 `forward` | frontend 到达 api Service，由其选择 forwarder 容器 |

两个 Deployment 挂载同一个 ReadWriteMany PVC。启用 Postgres 时，API 入口应用 `overlays/api.overlay.yml`，会话持久化与流转发状态存入 Postgres 而不是 API Pod。PVC 拥有跨副本浏览器会话密钥。`apiReplicas` 默认为 1；验收冒烟保持不超过 2。

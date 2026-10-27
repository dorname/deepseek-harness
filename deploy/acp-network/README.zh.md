# ACP-over-network 预发部署

[English](README.md) | 中文

本目录包含在预发环境部署独立 ACP-over-network 服务器的 Dockerfile、辅助脚本与 Kubernetes 示例清单。

## 文件

| 文件 | 用途 |
|---|---|
| `Dockerfile` | 构建 `dsh --profile acp-network` 的多阶段镜像 |
| `.dockerignore` | 构建上下文排除项，与 `deploy/cluster-web` 保持一致 |
| `scripts/build-image.sh` | 构建并可选推送预发镜像 |
| `scripts/deploy-staging.sh` | 应用清单并等待 rollout 完成 |
| `scripts/smoke-staging.sh` | 对已部署服务器运行协议 smoke |
| `k8s/deployment.yaml` | 运行 `dsh --profile acp-network` 的 dsh Pod |
| `k8s/service.yaml` | ACP 端口的集群 Service |
| `k8s/ingress.yaml` | 暴露 `/acp` 并支持 WebSocket upgrade 的 Ingress |
| `k8s/networkpolicy.yaml` | 将入口流量限制到 dspm chat relay |
| `k8s/pvc.yaml` | 支撑 Pod 持久 `$DSH_HOME` 的 PersistentVolumeClaim |
| `k8s/secret.example.yaml` | 密钥示例；复制、填写后以 `secret.yaml` 应用 |

## 构建镜像

在仓库根目录执行：

```sh
./deploy/acp-network/scripts/build-image.sh
```

环境变量覆盖：

- `DSH_ACP_NETWORK_IMAGE` — 镜像名（默认 `dsh-acp-network`）
- `DSH_ACP_NETWORK_TAG` — 镜像标签（默认 `git rev-parse --short HEAD`）
- `DSH_ACP_NETWORK_PUSH_REGISTRY` — 构建后推送至此 registry

## 部署

1. 复制并编辑密钥：
   ```sh
   cp deploy/acp-network/k8s/secret.example.yaml deploy/acp-network/k8s/secret.yaml
   # edit secret values
   ```
2. 部署到当前 kubectl context/namespace：
   ```sh
   ./deploy/acp-network/scripts/deploy-staging.sh
   ```
   可选覆盖：
   - `DSH_ACP_NETWORK_NAMESPACE` — 目标命名空间（默认 `default`）
   - `DSH_ACP_NETWORK_IMAGE` / `DSH_ACP_NETWORK_TAG` — 要部署的镜像
   - `DSH_ACP_NETWORK_PUSH_REGISTRY` — 从远程 registry 拉取镜像
   - `DSH_ACP_NETWORK_HOME_SIZE` — PVC 容量请求（默认 `10Gi`）

   脚本在应用清单后会滚动重启 Deployment，以确保 secret 变更被新 Pod 加载。

3. 验证 Pod 就绪：
   ```sh
   kubectl rollout status deployment/dsh-acp-network
   ```

## 运行本地协议 smoke

包级 smoke 无需 Kubernetes，在进程内启动服务器：

```sh
pnpm -F @deepseek-ai/dsh-acp-network smoke
```

该命令验证 WebSocket 传输、HMAC token 认证、完整 prompt 闭环（使用 mock LLM）以及断连后 `session/resume` 恢复。

## 验证预发端到端

部署到预发后，转发 Service 并运行 smoke runner：

```sh
kubectl port-forward service/dsh-acp-network 13080:80 &
export ACP_SMOKE_URL=ws://127.0.0.1:13080/acp
export ACP_SMOKE_SECRET=<same-secret>
export ACP_SMOKE_SUBJECT=<same-subject>
export ACP_SMOKE_AUDIENCE=<same-audience>
./deploy/acp-network/scripts/smoke-staging.sh
```

当未设置 `DEEPSEEK_API_KEY` 时，runner 自动启用 `ACP_SMOKE_NO_PROMPT=true`，仅验证握手、认证、会话生命周期与 resume，不调用 LLM。要运行完整 prompt smoke，可导出有效 key 或设置 `ACP_SMOKE_NO_PROMPT=false`。

## 持久化

Pod 的 `$DSH_HOME` 挂载 `dsh-acp-network-home` PVC，会话日志、附件与 KV 存储在 Pod 替换后仍然保留，重连后 `session/resume` 从该状态恢复。用以下命令验证：

```sh
ACP_SMOKE_VERIFY_POD_RESTART=true ./deploy/acp-network/scripts/smoke-staging.sh
```

脚本会创建一个会话、滚动重启 Deployment 并恢复同一会话 id；脚本自建临时 port-forward，因此无需 `ACP_SMOKE_URL`，但需要可用的 `kubectl`（namespace 取 `DSH_ACP_NETWORK_NAMESPACE`）。

客户端契约：每个模型请求开始前都会做 checkpoint，因此被 Pod 替换打断的 turn 不会把部分输出带入恢复后的历史，客户端需要重发 prompt。恢复会话要求提供该会话原始的 `cwd`。

扩展到多副本前需要先做会话亲和路由：活跃会话由单个 Pod 进程持有，resume 没有跨 Pod 互斥。开始该项工作后，Postgres 持久化是既定的升级路径。

## 回滚

缩容至零或删除 Deployment：

```sh
kubectl scale deployment dsh-acp-network --replicas=0
```

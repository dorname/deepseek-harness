# 部署报告：ACP-over-network

> 提案：`20261020-1643-acp-over-network`
> 时间：2026-10-27T15:46+08:00
> 目标环境：本地 Docker Desktop Kubernetes staging（namespace `dsh-acp-network-staging`）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 创建 namespace `dsh-acp-network-staging` | 成功 |
| 写入 `deploy/acp-network/k8s/secret.yaml`（gitignored，staging 临时凭证） | 成功 |
| 构建镜像 `dsh-acp-network:71da5f8d85` | 成功 |
| `./deploy/acp-network/scripts/deploy-staging.sh` | 成功（rollout 完成，Deployment 1/1） |
| 本地协议 smoke `pnpm -F @deepseek-ai/dsh-acp-network smoke` | 通过（完整 prompt + resume） |
| Staging smoke（port-forward + `ACP_SMOKE_NO_PROMPT=true`） | 通过（握手 / 会话生命周期 / resume；无 LLM key 故跳过 prompt） |

## 执行命令

```sh
kubectl create namespace dsh-acp-network-staging
./deploy/acp-network/scripts/build-image.sh
DSH_ACP_NETWORK_NAMESPACE=dsh-acp-network-staging \
  DSH_ACP_NETWORK_IMAGE=dsh-acp-network \
  DSH_ACP_NETWORK_TAG=71da5f8d85 \
  ./deploy/acp-network/scripts/deploy-staging.sh
pnpm -F @deepseek-ai/dsh-acp-network smoke
kubectl -n dsh-acp-network-staging port-forward service/dsh-acp-network 13080:80
ACP_SMOKE_URL=ws://127.0.0.1:13080/acp ACP_SMOKE_NO_PROMPT=true \
  ./deploy/acp-network/scripts/smoke-staging.sh
```

## 迁移结果

无数据迁移。新建 PVC `dsh-acp-network-home`（10Gi，Bound）。

## 服务启动结果

- Deployment `dsh-acp-network`：Available 1/1
- Service `dsh-acp-network`：ClusterIP:80 → container 3080
- Ingress / NetworkPolicy / Secret 已应用

## 回滚点

1. `kubectl -n dsh-acp-network-staging scale deployment/dsh-acp-network --replicas=0`
2. 或删除 namespace：`kubectl delete namespace dsh-acp-network-staging`
3. Secret 轮换：更新 `k8s/secret.yaml` 后重新 `deploy-staging.sh`（脚本含 rollout restart）

## 未解决风险

- 工作区无 `DEEPSEEK_API_KEY`：staging 端到端 **prompt** smoke 未对真实 LLM 验证；本地协议 smoke 已用 mock LLM 覆盖 prompt 闭环。
- `default` namespace 仍有历史 `dsh-acp-network` Deployment（0/0），与本次 staging namespace 并存；未改动该旧资源。
- 多副本会话亲和尚未交付；当前 staging 保持单副本。

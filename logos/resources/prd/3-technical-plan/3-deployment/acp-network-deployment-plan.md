# ACP-over-network 部署计划

> 变更：20261020-1643-acp-over-network

## 目标

在 Pod 形态下暴露 dsh 网络 ACP 入口，供 dspm chat relay 通过 WebSocket 与短期 token 连接。

## 端口暴露

- dsh webserver 默认监听 `127.0.0.1`；在 K8s 中通常由 sidecar 或 Service 暴露。
- ACP WebSocket/HTTP route 挂载于 `/acp`（可配置 `config.path`）。
- 不新增独立端口；复用现有 dsh webserver 端口（由 `dsh-host-webserver` 配置决定）。

## Service / Ingress

```yaml
apiVersion: v1
kind: Service
metadata:
  name: dsh-acp-network
spec:
  selector:
    app: dsh
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dsh-acp-network
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  rules:
    - host: dsh-acp-network.example
      http:
        paths:
          - path: /acp
            pathType: Prefix
            backend:
              service:
                name: dsh-acp-network
                port:
                  number: 80
```

## NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: dsh-acp-network
spec:
  podSelector:
    matchLabels:
      app: dsh
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: dspm-chat-relay
      ports:
        - protocol: TCP
          port: 8080
```

## Token Secret 注入

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: dsh-acp-network-secret
type: Opaque
stringData:
  DSH_ACP_NETWORK_SECRET: <shared-hmac-secret>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dsh
spec:
  template:
    spec:
      containers:
        - name: dsh
          env:
            - name: DSH_ACP_NETWORK_SECRET
              valueFrom:
                secretKeyRef:
                  name: dsh-acp-network-secret
                  key: DSH_ACP_NETWORK_SECRET
            - name: DSH_FLEET_USER_ID
              value: "${DSH_FLEET_USER_ID}"
            - name: DSH_ACP_NETWORK_AUDIENCE
              value: "dsh-acp"
```

## 探针

- 健康/就绪探针复用 dsh webserver 的 `/healthz` 或 `/readyz`（由 cluster-web 现有配置提供），不单独为 ACP 增加探针。
- WebSocket 长连接的超时由 ingress 配置（如 nginx 的 proxy-read-timeout）承载。

## 回滚方案

1. 关闭网络 ACP route：将 `acp-network` 插件在 cordis.patch.yml 中 `disabled: true`，或重新部署不启用 acp-network-app bundle 的镜像 revision。
2. 缩容：将 dsh Deployment 副本数缩至 0，或单独关闭暴露 `/acp` 的 Service/Ingress。
3. 轮换 secret：如 token 泄露，更新 `DSH_ACP_NETWORK_SECRET` 并滚动重启；旧 token 在 `exp` 后失效，已用 `jti` 集合随进程重启清空。

## 本地 Staging 验证

1. 使用 `pnpm -F @deepseek-ai/dsh-acp-network smoke` 运行本地协议 smoke（不依赖 K8s 与真实 LLM key）。
2. 使用 `dsh --profile acp-network` 在本地启动（需配置 `DSH_ACP_NETWORK_SECRET`）。
3. 使用测试 client 通过 `ws://127.0.0.1:PORT/acp` 连接，携带有效 token。
4. 验证：完整 prompt 闭环、断连 resume、权限确认双向帧。

K8s staging manifests 位于 `deploy/acp-network/k8s/`。

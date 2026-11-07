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

## 会话审批策略配置发布（S49）

- 发布物包含 `acp` 审批策略入口实现；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加会话级审批策略验证：
  1. 有效 token 连接后 `session/set_config_option { permission_policy: 'always' }`。
  2. 发起带工具调用的 prompt，验证 `session/request_permission` 在 WebSocket 双向帧上往返 ≤5s，allow-once 后工具执行。
  3. 对第二次调用 reject-once，验证调用被拒且会话继续、`stopReason` 正常结算。
  4. 设置 `permission_policy=paranoid` 验证 invalid params 与状态不变。
  5. `session/close` → 新连接 resume，验证策略经折叠恢复且 configOptions 回显。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；回滚后旧版对含 `always` 值的 `approval/policy` 会话事件的读取行为已在实现期评估并记录，不作为回滚前置条件。
- 权限应答保持一次性选项（allow-once / reject-once / cancelled），relay 侧实现不需要为 S49 增加新的应答语义。

## 会话技能清单入口发布（S50）

- 发布物包含 `acp` 技能枚举扩展方法实现；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- `acp-network` profile 经 `dsh-base` 已挂载技能注册表与文件系统发现插件，部署无需新增装配或配置。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加技能枚举验证：
  1. 有效 token 连接后 `session/new`，调用 `session/skills_list { sessionId }`。
  2. 验证响应为 `{ skills: [...] }` 数组、按名字典序排列、每项含 `name` / `description` / `modelInvocable` / `userInvocable`；与部署环境已知技能目录（用户级与项目级根目录）核对一致性。
  3. 对未知会话 id 调用，验证 invalid params 类错误。
  4. 回归既有 prompt/resume、`skills/list` UI 通道与 S49 审批策略路径。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更只读且无会话数据与配置变更，回滚无迁移。
- relay 侧实现不需要为 S50 增加新语义：方法请求/响应均为普通 JSON-RPC 帧，透传即可。

## 计划模式入口发布（S51）

- 发布物包含 `acp` 标准方法 `session/set_mode` 注册、new/resume `modes` 广告、`current_mode_update` 派发与 plan-review 评审应答者；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- `acp-network` profile 经 `dsh-base` 已挂载 `@deepseek-ai/dsh-plan-mode`，部署无需新增装配或配置。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加模式面验证：
  1. 有效 token 连接后 `session/new`，核对响应 `modes` 为 plan/normal 二值且 `currentModeId` 为 normal。
  2. `session/set_mode { modeId: 'plan' }` 后核对 `current_mode_update` 到达；`session/resume` 后 `currentModeId` 恢复为 plan；切回 normal 同样核对。
  3. 重复设置当前模式确认无冗余更新；对未知 modeId 验证 invalid params 词表错误。
  4. 回归既有 prompt/resume、审批策略（S49）与技能枚举（S50）路径。
- plan-review 的 request_permission 映射依赖模型调用 `exit_plan_mode`，不在确定性冒烟范围，由单元与真实 API e2e 承载；dspm 集成验收可在真实会话中触发计划评审并复用三态映射断言。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更零新增持久化数据，回滚无迁移；回滚后旧构建对 `session/set_mode` 返回 -32601、`modes` 字段消失（客户端按可选字段容忍）。
- relay 侧实现不需要为 S51 增加新语义：`current_mode_update` 与评审请求均为标准 JSON-RPC 帧透传；dspm UI 侧需实现 optionId 词表（approve / keep-planning）的评审卡片。

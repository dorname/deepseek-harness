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

## 会话压缩入口发布（S52）

- 发布物包含 `acp` 扩展方法 `session/compact` 与 capability 门控的 `compaction_update` 派发；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- `acp-network` profile 经 `dsh-base` 已挂载压缩服务与命令插件，部署无需新增装配或配置；自动触发阈值等压缩策略仍为部署配置所有，本变更不新增旋钮。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加压缩面验证：
  1. 有效 token 连接后 `session/new`，真实模型 prompt 产历史，调用 `session/compact { sessionId }`。
  2. 核对成功响应结构（compactionId / summarySeq / shadowedCount / shadowedTokenCount / summary）；`session/resume` 后历史已被 shadow 替换。
  3. 压缩进行中并发第二次调用验证 `data.code: 'busy'`；对未知会话 id 验证 invalid params。
  4. 声明 `clientCapabilities.session.compaction` 的连接核对 `compaction_update`（in_progress → completed）；未声明的连接核对零通知。
  5. 回归既有 prompt/resume、审批策略（S49）、技能枚举（S50）、计划模式（S51）与 `/compact` 命令路径。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更零新增持久化数据，已压缩会话旧构建可正常打开，回滚无迁移。
- relay 侧实现不需要为 S52 增加新语义：方法与通知均为普通 JSON-RPC 帧，透传即可；dspm 客户端按其 §6 答复决定是否声明 compaction 能力（不声明即纯同步语义）。

## 多供应商路由供给发布（S53）

- 发布物包含 llm-pi-ai 配置双键形态与归一化；acp-network 包零代码变化——端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- dspm 部署指引：在其 profile patch 增加 llm-pi-ai `providerList` 键（数组形式：每项 `{ provider 路由键, apiKeyEnv, baseURL, … }`；或沿用既有 `providers` dict），保留 acp-network 行的 `provider` / `model` 值对为默认路由；apiKeyEnv 引用的凭据经凭据存储或环境变量供给。同实例由此服务多供应商，切换经 `set_config_option`（既有协议面）。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加多供应商面验证：
  1. 数组组合（两个本地 mock 供应商路由）启动，`session/new` 核对 configOptions 两供应商分组与默认路由。
  2. `set_config_option` 切换到另一供应商模型 → prompt 往返命中被切换路由（mock 后端记录）；断开重连 `session/resume` 后选择保持。
  3. 冲突组合（`providers` 与 `providerList` 同供）独立进程启动，记录加载失败指名诊断。
  4. 回归既有 prompt/resume、审批策略（S49）、技能枚举（S50）、计划模式（S51）、压缩面（S52）与 `/compact` 命令路径。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret），另加组合 patch 还原注意（见 core-01 §十五：旧构建拒绝数组形式配置）；零持久化数据，回滚无迁移。
- relay 侧（dspm）零新语义：配置面变化对协议帧透明；dspm 客户端无需新增 capability 声明或方法。

### goal 授权卡（S54）

- staging ACP 会话内驱动未授权 goal 完成（mock 模型触发 `complete` 调用即可），验证 `session/request_permission` 携带 Authorize/Deny 选项词汇、Authorize 应答后完成提交且会话日志含注入的源 user 用户消息（SMOKE-acp-network-08；本地通道全量执行，staging 无交互握手按 skip 语义记录，永不报 PASS）。
- dspm 侧指引：goal 授权卡是普通权限卡片（`session/request_permission`），按既有选项卡片处理；无需 capability 声明；`goal-review` 意图为可选呈现优化——识别后可渲染为 goal 审批卡，不识别则通用选项卡同样可用（应答编码不变）。
- Deny/取消路径与无通道 fail-fast（headless 组合）纳入回归；plan-review 卡（S51）不受新应答者影响。

### 会话导出（S55）

- 发布物包含 bridge 导出三方法（`session/export_begin` / `session/export_read` / `session/export_cancel`）与 dsh-acp 两个新 Config 键（`exportChunkBytes` 默认 262144、`exportCompressionLevel` 默认 6，均加载期校验）；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加导出面验证：
  1. 有效 token 连接后 `session/new`，mock/真实模型 prompt 产事件，`export_begin { sessionId }` → `export_read` 循环至 eof → 解包断言 `session.v4.jsonl` 首条目含驱动期事件（SMOKE-acp-network-09；纯方法调用无交互握手，staging 具备条件即执行）。
  2. `export_cancel` 后 read 核对 `data.code: 'unknown_cursor'`；伪造游标 id 的 read/cancel 同词表；未知会话 id begin 得 invalid params。
  3. `includeDescendants: true` 的导出核对 `subagents/` 条目（有子代理会话时）；无子代理会话核对仅根日志。
  4. Config 越界值（如 `exportChunkBytes: 1024`）独立进程启动，记录加载失败。
  5. 回归既有 prompt/resume、审批策略（S49）、技能枚举（S50）、计划模式（S51）、压缩面（S52）、多供应商（S53）、goal 授权卡（S54）与 web 导出 HTTP 面（S26）。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更零新增持久化数据，导出只读会话日志，回滚无迁移；旧构建上导出方法 methodNotFound。
- relay 侧实现不需要为 S55 增加新语义：三方法均为普通 JSON-RPC 帧（响应体较大——每 read 至多约 341 KiB base64 帧，relay/代理的消息大小上限需覆盖，WS 默认 100 MiB 足够），透传即可。
- dspm 侧指引：无 capability 声明，普通请求序列消费（begin → read × N 至 eof；中止用 cancel）；字节流写文件 + 标准 unzip，布局与 web 下载一致（`session.v4.jsonl` / `subagents/` / `media/` / `files/`）；导出含完整原始日志（内部事件、工具输出、subagent 日志与附件字节），镜像侧按完整归档对待；自建镜像可在该面可用后退役。

# 变更提案：cluster-web-k8s（同域集群 K8s/Helm 投影 · P2）

> module: core | created: 2026-10-12

## 变更原因

P0/P1 已交付 Compose 与 `dsh up`。本变更把同一角色集合投影到 K8s/Helm：Ingress 同域分流；每 API Pod = loopback `dsh` + 公网 edge sidecar（遵守禁止 `0.0.0.0` 绑 dsh）；验收默认低副本与 CPU 约束不变。不做 Operator/CRD。

## 变更类型

设计级 + 代码级（Helm chart + SMOKE-core-22 清单校验；场景 S45）

## 变更范围

- 需求/规格/部署：S45；`core-01-deployment-plan.md` 追加 Helm 一键
- smoke：SMOKE-core-22（无集群时校验清单与默认副本；有集群时可选 apply）
- 不做：Operator、多租户命名空间迁移

## 部署影响

- 需要部署：是（staging 清单校验；真实 apply 可选）
- 数据迁移：否；回滚：删 release；smoke：是

## UI/UX

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

1. `deploy/cluster-web/chart/`：Helm chart，`values.yaml` 默认 `apiReplicas=1`、`runnerReplicas=0`，硬文档上限 2。
2. API Pod：dsh 容器 loopback + edge sidecar 容器；Service/Ingress 同域。
3. SMOKE-core-22：解析 values/templates，断言默认副本与 Ingress 路径；串行；不拉起多副本进程树。

## 验收资源约束

与 S43/S44 相同；本提案 smoke **不**在无集群环境起多 Pod，避免打爆 CPU。

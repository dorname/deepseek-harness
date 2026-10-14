---
kind: reference
description: "cluster-web 本地 Compose 与 Docker Desktop Kubernetes staging 的实际验证记录。"
---

# cluster-web 本地 staging 验证

验证日期：2026-10-14。执行范围经用户明确授权：`openlogos verify`、`openlogos smoke`、本地 Docker Compose 和 Docker Desktop Kubernetes staging 部署验证。

## 实际部署证据

| 检查 | 结果 |
|---|---|
| Docker Compose | frontend 1 个容器、API 2 个容器、Postgres；SMOKE-core-24 通过，独立运行 CPU 峰值 56.2% |
| 容器启动入口 | PID 1 分别运行 `frontend.mts` 与 `api.mts` |
| 同域认证 | token 换票返回 303；携带 cookie 的 SPA 请求返回 200，包含 boot 数据；未认证 API 返回 401；认证 API 到达路由 |
| Kubernetes 环境 | context `docker-desktop`，namespace `dsh-cluster-web-staging`，Helm release `dsh` |
| Kubernetes 就绪 | frontend 1/1、API 2/2、Postgres 1/1 |
| 共享认证存储 | `dsh-dsh-home` PVC 已 Bound，1Gi、RWX；同一 frontend cookie 在两个 API Pod 上都能调用 `session/list` |
| 数据库连接 | 实际数据库包含 `sessions`、`session_generations`、`session_tail`、会话版本表以及流转发表和版本表 |
| 冷启动 | 数据库未启动时，两个 API Pod 持续停在 `Init:0/1`；恢复数据库后自动就绪，API 请求通过 |
| API Pod 替换 | 创建空测试会话后滚动重启 API；两个新 Pod 均能读取原会话，同一 frontend cookie 仍有效；未调用模型 |
| Helm 校验 | `helm lint --strict` 通过；API 双副本与禁用内置 Postgres 的两套渲染清单均通过 kubectl 严格客户端校验 |

## 修复内容

- Docker 镜像使用可由 Compose `command` 覆盖的 `CMD`，保证两个服务运行各自入口。
- API 与 frontend 容器实际挂载共享 `DSH_HOME` PVC，并使用就绪探针。
- API 启动前等待内置 Postgres Service 接受连接；滚动升级不增加额外 frontend/API 副本。
- 命名空间由 Helm `--create-namespace` 管理，chart 不重复创建 Namespace。
- `dsh up` 转发 SIGINT/SIGTERM，并等待 supervisor 的进程退出和输出流关闭；冒烟检查完整退出及退出码。
- 网关测试清理升级后的 TCP 连接；进程树冒烟保留端口直到分配完成，并在进程提前退出时立即报告失败。
- SMOKE-core-24 验证实际容器入口和认证后的 API 请求。
- Desktop 首启人工用例显式记录为跳过，不计为已验证；完整 smoke 使用独立的临时 fleet fixture 补齐认证、隔离和生命周期前置条件。

## 本地检查与正式门禁

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/fleet/gateway/tests/gateway.spec.ts apps/cli/tests/up.spec.ts apps/cli/tests/cluster-web-fe-be-containers.spec.ts apps/cli/tests/cluster-web-fe-split.spec.ts` | 4 个文件、43 个测试通过 |
| `pnpm run typecheck` | 通过 |
| `pnpm run lint` | 通过 |
| 两组部署 README 的 `verify-translation-pairing` | 通过 |
| `pnpm run test:docs` | 14 项通过、7 项失败；失败信息见 `/tmp/dsh-cluster-test-docs.log` |
| `pnpm run doc-sync` | 28 项通过、14 项失败；失败信息见 `/tmp/dsh-cluster-doc-sync.log` |
| `openlogos verify` | Gate 3.6 PASS；预跑 exit 0，100 个测试通过、97 个测试跳过；验收账本 36 项通过、141 项跳过，无失败 |
| `openlogos smoke --env staging` | Gate 3.8 PASS；24 项均有记录，13 项通过、11 项跳过，无失败；SMOKE-core-24 CPU 峰值 39.2% |

此前正式验收曾因容器构建期间 CPU 峰值超过 80% 而失败；这些失败不等同于部署功能通过，也不计为通过。嵌入式 Postgres 的部分用例因 root 环境明确跳过，真实模型用例受凭证可用性约束；跳过不代表已验证。

## 验证范围

HTTP 请求通过 Kubernetes Service 和逐 Pod 的临时端口转发验证，临时转发进程已清理。Ingress 清单已创建，但 Docker Desktop 当前未配置 Ingress Controller，因此尚未验证实际 Ingress 流量。Docker Desktop 是单节点集群，本轮不能作为跨节点 RWX 存储的验证证据。

内置 Kubernetes Postgres 使用临时存储，本轮冷启动会重建数据库；其 Pod 替换不会保留数据库数据。API Pod 的替换验证保留了数据库 Pod。Compose 冒烟容器、测试卷和临时 fleet fixture 在验证后清理；Kubernetes staging 部署保留供检查。变更已按用户授权归档，修复与验证记录保存在本地；尚未推送，也未执行分支合并。

本轮未执行真实模型任务、执行池接管和调度/webhook 的嵌入式数据库用例，也未执行 Desktop 人工首启检查。正式门禁的 PASS 包含上述显式跳过项，不能解读为全部产品链路均已验证。

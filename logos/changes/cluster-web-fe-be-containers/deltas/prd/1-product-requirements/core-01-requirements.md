# delta — core-01-requirements.md（变更 cluster-web-fe-be-containers）

## MODIFIED — 三、场景总览（表追加 S47 行；整表守恒携带既有行）

在 S46 行之后追加：

| S47 | 同域前后端双容器 + API 容器级副本 | 运维 compose up frontend/api（可 scale api） | P03/P08 | P0 |

并更新 `logos/logos-project.yaml`：`scenario_counter.next_id: 48`。

## ADDED — 四、核心场景详述 · S47

### S47: 同域前后端双容器 + API 容器级副本

- **触发条件**：运维使用 `deploy/cluster-web` 的 Compose（或等价 Helm）且启用 **frontend / api 双服务**；可将 `api` scale 到 2
- **用户价值**：Docker 环境中前后端分属不同容器；多后端以容器副本可见；浏览器仍只开一个 origin（← P03/P08；承接 S46 逻辑契约的物理落地）
- **优先级**：P0
- **主路径**：compose 拉起 `frontend`（公网 edge + loopback shell）与 `api`×N（每容器：loopback API-only + 内网 forwarder）→ 共享 `$DSH_HOME` volume → 用户打开 `PUBLIC_URL?token=` → shell 换 cookie → `/api` 经 edge 打到 api 服务（Docker DNS RR）→ compose down / SIGTERM 排空。

#### 验收条件
##### 正常：双容器可见
- **GIVEN** compose 已 up
- **WHEN** 执行 `docker compose ps`
- **THEN** 至少存在独立的 `frontend` 与 `api` 服务容器（非单一 `cluster` 进程树服务）
##### 正常：API 容器级副本
- **GIVEN** `API_REPLICAS`/`scale`=2（验收上限）
- **WHEN** 查看 compose 中 `api` 服务实例
- **THEN** 可见 ≥2 个 api 容器；edge 将 `/api` 分发到 api 服务上游
##### 正常：同域分流可达
- **GIVEN** frontend=1、api 副本=1（smoke 默认）或 2（诊断）
- **WHEN** 经 frontend 公网口 `PUBLIC_URL?token=` 完成换票后请求 `/` 与 `/api`
- **THEN** `/` 返回注入 boot 的 HTML；带 cookie 的 `/api` 非 401；dsh 仍不绑 `0.0.0.0`
##### 正常：共享 DSH_HOME
- **GIVEN** frontend 与全部 api 挂载同一 `$DSH_HOME` volume
- **WHEN** 在任一 api 容器验证 cookie
- **THEN** `browser-session` 签名跨 api 容器互认
##### 正常：副本上限与 CPU
- **GIVEN** 验收配置
- **WHEN** api 容器副本 >2
- **THEN** 启动拒绝或 compose 配置硬上限生效；冒烟串行且主机 CPU 峰值 ≤ 部署配置阈值
##### 正常：排空
- **GIVEN** 双服务拓扑就绪
- **WHEN** compose down 或向各服务发 SIGTERM
- **THEN** 容器/进程退出；宽限内结束

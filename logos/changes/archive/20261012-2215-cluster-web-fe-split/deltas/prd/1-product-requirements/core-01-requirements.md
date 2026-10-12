# delta — core-01-requirements.md（变更 cluster-web-fe-split）

## MODIFIED — 三、场景总览（表追加 S46 行；整表守恒携带既有行）

在 S45 行之后追加：

| S46 | 同域前后端分离（API-only + shell） | 运维启用 cluster-web 三分流 / 外仓替换 shell | P03/P08 | P0 |

并更新 `logos/logos-project.yaml`：`scenario_counter.next_id: 47`。

## ADDED — 四、核心场景详述 · S46

### S46: 同域前后端分离（API-only + shell）

- **触发条件**：运维使用 `deploy/cluster-web`（compose / supervise / `dsh up` / Helm）且启用前后端分流；或外仓前端按同域契约替换 shell
- **用户价值**：浏览器仍只开一个 origin；前端托管与后端 API 副本解耦，便于前端独立成仓部署（← P03/P08；编排器无关「前端独立部署」原则落地）
- **优先级**：P0
- **主路径**：supervise 拉起 shell（`serveFrontend: true`）+ N×API-only（`serveFrontend: false`）→ edge 将 `/`（及静态、`/plugins`）指向 shell、`/api` 轮询 API → 用户打开 `PUBLIC_URL?token=` → shell 换 cookie → 浏览器相对路径调用 `/api` → SIGTERM 排空子树。

#### 验收条件
##### 正常：同域分流可达
- **GIVEN** shell=1、API_REPLICAS=1、RUNNER_REPLICAS=0（smoke 默认）
- **WHEN** 经 edge 的 `PUBLIC_URL?token=` 完成换票后请求 `/` 与 `/api`
- **THEN** `/` 返回注入 boot 的 HTML；带 cookie 的 `/api` 非 401；浏览器 Host 经 edge 原样转发
##### 正常：API-only 不提供 SPA
- **GIVEN** API 副本 `serveFrontend: false`
- **WHEN** 直接请求该副本的 `/`（绕过 edge 的静态上游）
- **THEN** 无 frontend-static fallback（404 或等价非 SPA）；`/api` 仍可服务
##### 正常：无跨域
- **GIVEN** 产品信任栅栏与 `SameSite=Strict` host-only cookie
- **WHEN** 试图将前端与 API 部署在不同浏览器 origin
- **THEN** 不在本场景支持范围；须同域反代统一 origin
##### 正常：副本上限与 CPU
- **GIVEN** 验收配置
- **WHEN** API_REPLICAS>2 或 RUNNER_REPLICAS>2
- **THEN** supervise 拒绝启动；冒烟串行且主机 CPU 峰值 ≤ 部署配置阈值
##### 正常：SIGTERM 排空
- **GIVEN** shell + API + edge 进程树就绪
- **WHEN** 向 supervise 发 SIGTERM
- **THEN** 子进程退出；supervise 在宽限内结束

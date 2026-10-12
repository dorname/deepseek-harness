# core S46（同域前后端分离）— 测试用例

> 来源：变更 `cluster-web-fe-split`。场景来源 `core-01-requirements.md` §S46。
> 验收资源约束：与 S43 相同（API/RUNNER ≤2；smoke 默认 1 api / 0 runner + 1 shell；串行；CPU ≤ `cpuThresholdPercent`）。

## S46: 同域前后端分离（API-only + shell）

### 单元（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S46-01 | serveFrontend=false 不挂 SPA | web-app | Config.serveFrontend=false | 加载组合 | 无 frontend-static fallback |
| UT-S46-02 | serveFrontend=true 默认挂 SPA | web-app | 默认 Config | 加载组合 | frontend-static 注册 |
| UT-S46-03 | edge 路径分流 | edge.mts | STATIC + API 上游已配 | pickUpstream(`/` / `/api/x` / `/plugins/a`) | `/`与`/plugins`→STATIC；`/api`→API 池 |
| UT-S46-04 | 副本超上限拒绝 | supervise | 无 | API_REPLICAS=3 | 启动失败，明确错误 |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S46-01 | token 换 cookie 后同域可用 | S46-AC 同域分流 | 树就绪 | `/?token=` → 带 cookie `GET /` 与 `/api` | 303+Set-Cookie；HTML 含 `__DSH_BOOT__`；`/api` 非 401 |
| ST-S46-02 | 无 cookie API 拒绝 | S46-AC 同域分流 | 树就绪 | 无 cookie `GET /api` | 401 |
| ST-S46-03 | SIGTERM 排空 | S46-AC 排空 | 树就绪 | 发 SIGTERM | 子树退出；CPU ≤ 阈值 |

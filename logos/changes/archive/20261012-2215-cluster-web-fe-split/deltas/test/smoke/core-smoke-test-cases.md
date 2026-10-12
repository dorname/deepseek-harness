# delta — core-smoke-test-cases.md（变更 cluster-web-fe-split）

## MODIFIED — 二、冒烟测试用例（追加 SMOKE-core-23）

在 SMOKE-core-22 行之后追加：

| SMOKE-core-23 | cluster-web 同域前后端分离 | 部署方案 · cluster-web fe-split / S46 | staging | deploy/cluster-web 存在；shell=1、API_REPLICAS=1、RUNNER_REPLICAS=0 | supervise（或 compose）→ `/?token=` → cookie GET `/` 与 `/api` → SIGTERM | 303+cookie；HTML 含 boot；无 cookie `/api`→401；子树退出；串行；CPU 峰值 ≤ 部署配置阈值 |

## MODIFIED — 三、覆盖度校验（追加）

- [x] cluster-web 同域前后端分离：SMOKE-core-23（1 shell / 1 api / 0 runner；token/cookie/API；串行；CPU 不超部署配置阈值）

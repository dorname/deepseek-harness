# delta — core-smoke-test-cases.md（变更 cluster-web-fe-be-containers）

## MODIFIED — 二、冒烟测试用例（追加 SMOKE-core-24）

在 SMOKE-core-23 行之后追加：

| SMOKE-core-24 | cluster-web 前后端双容器 | 部署方案 · cluster-web fe-be-containers / S47 | staging | deploy/cluster-web 存在；frontend=1；api 副本=1（诊断可 2） | compose up → 断言 frontend/api 分离（scale=2 时 ≥2 api 容器）→ `/?token=` → cookie GET `/` 与 `/api` → compose down | 服务分离可见；303+cookie；HTML 含 boot；无 cookie `/api`→401；串行；CPU 峰值 ≤ 部署配置阈值 |

## MODIFIED — 三、覆盖度校验（追加）

- [x] cluster-web 前后端双容器：SMOKE-core-24（frontend/api 分离；可选 api×2；token/cookie/API；串行；CPU 不超部署配置阈值）

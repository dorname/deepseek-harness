# delta — core-smoke-test-cases.md（变更 cluster-web-compose）

## MODIFIED — 二、冒烟测试用例（追加 SMOKE-core-20）

在 SMOKE-core-19 行之后追加：

| SMOKE-core-20 | cluster-web 同域一键 | 部署方案 · cluster-web Compose / S43 | staging | deploy/cluster-web 存在；API_REPLICAS=1、RUNNER_REPLICAS=0 | supervise（或 compose）→ GET PUBLIC_URL → SIGTERM | 非 5xx；子树退出；串行；CPU 峰值 ≤ 部署配置阈值 |

## MODIFIED — 三、覆盖度校验（追加）

- [x] cluster-web 同域一键：SMOKE-core-20（默认 1 api / 0 runner；串行；CPU 不超部署配置阈值）

# delta — core-S43-test-cases.md（变更 cluster-web-compose · ADDED 新文档）

# core S43（cluster-web Compose 一键）— 测试用例

> 最后更新：2026-10-11
> 来源：变更 `cluster-web-compose`。场景来源 `core-01-requirements.md` §S43。

## 资源约束（验收执行，适用于本文件全部 ST 与对应 SMOKE）

- smoke 默认 `API_REPLICAS=1`、`RUNNER_REPLICAS=0`；硬上限均为 2。
- 冒烟用例**串行执行**；禁止为验收并行叠跑多拓扑。
- 执行期间监控主机 CPU；峰值不超过 `cpuThresholdPercent`；超阈先降副本再继续。

## S43: 同域 cluster-web Compose 一键启动

### 1.1 单元测试用例

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S43-01 | 副本超上限拒绝 | supervise | 无 | API_REPLICAS=3 | 启动失败，明确错误 |
| UT-S43-02 | env 默认低副本 | `.env.example` | 文件存在 | 读取默认 | API=1、RUNNER=0 |

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S43-01 | 同域 edge 可达 | S43-AC-01 | 已 build 或源码可启动 | supervise → GET PUBLIC_URL | 非 5xx；CPU ≤ 阈值 |
| ST-S43-02 | SIGTERM 排空 | S43-AC-03 | 树就绪 | 发 SIGTERM | 子树退出 |

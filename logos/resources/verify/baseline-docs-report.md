# 文档基线检查报告

日期：2026-10-14。提案：[add-baseline-docs](../../changes/add-baseline-docs/proposal.md)。

本次补齐新增包 README、中英配对、公共 JSDoc、子系统类型文档及生成目录；运行时 API 签名和数据布局保持不变。租约和流转发的抽象服务文档按实际职责说明，Webhook 消费回调按至少一次调用说明幂等要求。

## 已执行检查

| 命令 | 结果 |
|---|---|
| `pnpm run test:docs` | 21 项通过，0 失败 |
| `pnpm run doc-sync` | 42 项通过，0 失败；包含文档示例编译和生成物检查 |
| `pnpm run lint` | 退出码 0 |
| `pnpm exec vitest run scripts/verify-concrete-terms.spec.ts scripts/doc-standard.spec.ts` | 79 个测试通过 |
| `pnpm exec vitest run scripts/verify-repository-references.spec.ts` | 11 个测试通过 |
| `pnpm exec vitest run packages/extensions/tool-cordis/tests/host.spec.ts` | 1 个测试通过 |
| `git diff --check` | 无错误 |

FleetManager 和 FleetGateway 的 README TypeScript 示例通过 `node --import tsx/esm --input-type=module` 原样运行；网关示例结束时关闭临时回环监听。Code Tour 按 README 的 Python 命令重新生成并校验，数据引用、单文件一致性及 JavaScript 语法通过。

## 检查范围

OpenLogos 外部协议的两个固定标识符仅在四份指定规格中允许；普通禁用措辞和相邻派生标识仍被测试拒绝。历史归档 delta 和基线 staging/resolved 副本保留提交时的字节；仓库引用检查继续检查当前资源、当前 delta、归档提案及运行报告。八份历史基线副本与原提交逐字一致，四份 resolved 副本匹配提交 journal 的 SHA-256。

部署验证沿用 [cluster-web staging 报告](cluster-web-staging-report.md)。本次文档维护未重新运行 Docker/Kubernetes 部署验证。

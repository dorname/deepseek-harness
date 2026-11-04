# 部署报告：DeepSeek 动态模型目录发现（dsh-provider-model-discovery）

> 提案：`dsh-provider-model-discovery`
> 时间：2026-11-04T12:25+08:00
> 目标环境：本地 staging 等效环境（用户授权的本地真实冒烟；官方公共端点 `api.deepseek.com` + 既有 Secret）

## 执行摘要

| 步骤 | 结果 |
|------|------|
| 构建发布物（`pnpm run build`，源码 commit `b3819933db`，版本 0.2.1-alpha.1） | 成功 |
| 既有 Secret 配置真实供应商端点（根 `.env` 的 `DEEPSEEK_API_KEY`，gitignored，未写入任何记录） | 成功 |
| 真实 SMOKE-core-25 预检（临时账本） | PASS（3605ms 前置预检 3494ms） |
| `openlogos smoke` 官方 dispatcher（Gate 3.8） | PASS：15 通过 / 0 失败 / 12 跳过（docker、python 等前置缺失自跳过） |
| `openlogos verify`（Gate 3.6，对最终账本与最终规格文本） | PASS（215 单测 + ST-S33-03 验收 runner；14/14 覆盖项确认） |
| `openlogos verify` 部署前预跑（`scripts/run-openlogos-tests.js`） | exit=0 |

## 真实目录证据（SMOKE-core-25，官方端点）

- 动态发现经候选链在 origin 根取得真实列表，ACP `configOptions` 发布 choices：`[["deepseek-official","deepseek-flash"], ["deepseek-official","deepseek-v4-pro"]]`，只含上游真实 ID。
- 回归目标 `deepseek-v4-flash` 不在当日真实目录中，按修订后的 AC-6 如实记录缺席并改选实际模型：第一模型 `deepseek-flash` 设置成功、prompt `end_turn`；第二模型 `deepseek-v4-pro` 设置成功、prompt `end_turn`。两次推理的请求模型 ID 与目录 ID 逐字一致。
- 官方 `/anthropic` 前缀路径实测无列表端点（`/anthropic/v1/models` 与 `/anthropic/models` 均 404），印证第二轮规格修订的候选链必要性；该事实与密钥无关，探测全程未记录密钥。

## 执行命令

```sh
pnpm run build
OPENLOGOS_SMOKE_RESULT_PATH=/tmp/smoke-core25-round2b.jsonl \
  pnpm exec tsx scripts/smoke-deepseek-discovery.ts   # 真实预检（先 skip 后 PASS 各一次）
openlogos smoke                                        # 官方账本：Gate 3.8 PASS
openlogos verify                                       # Gate 3.6 PASS（最终）
```

## 迁移结果

无数据库或 Session 格式迁移；既有 `provider/model` 字符串不变。升级指南见 `docs/upgrade-guide/v0.2.1-alpha.1/deepseek-dynamic-model-discovery/`（中英文）。

## 服务启动结果

- ACP profile 子进程启动正常（initialize → session/new → 目录发布 → 两次 set_config_option + prompt 全链路）。
- 启动与冒烟输出无密钥、无阻断性错误；发现失败不再被吞为空组。

## 回滚点

1. 回滚基线：上一版发布物 commit `a3adb681c4`（feat(dsh-provider-model-discovery): discover DeepSeek model catalogs from the endpoint）；revert `b3819933db` 后重建即可恢复首轮行为。
2. 会话数据无需回滚迁移；动态选择的模型 ID 按既有字符串持久化，旧版能否继续推理取决于其配置与上游支持（本次上游真实 ID `deepseek-flash`、`deepseek-v4-pro` 恰为旧静态默认项，回滚后仍可推理）。
3. 配置回退：需要离线或固定目录的部署在 `llm-deepseek` 条目显式设置 `models`；动态失败不会自动读取人工配置。

## 兼容性事实

- 显式 `models` 人工覆盖语义不变（跳过网络与凭据解析；`[]` 为明确空目录）。
- ACP 不再补回未列出的当前模型；`session/set_config_option` 拒绝目录外值；发现错误向客户端传播。
- 缓存键含凭据 HMAC 指纹（进程随机盐），不含候选序号或获胜 URL；URL 推导确定，同一配置每次尝试相同候选链。

## 未解决风险

- 真实 AC-6 在 `deepseek-v4-flash` 缺席的目录上以改选实际模型的方式通过；若部署方的验收要求必须以该精确 ID 推理，需等待上游目录实际提供或更换端点后重跑 SMOKE-core-25。
- `SMOKE-core-14/15/08/09/10/11/16-19` 等 12 项因本机缺 docker/python 等前置自跳过，与上一版发布物一致，非本变更回归；CI 平台矩阵负责这些信号。
- 分支既存漂移（干净 HEAD 同款，非本变更）：`verify-no-unknown-casts` 37 条、`constraints` 6 处 fleet package.json、`rescope-vendor:check` 17 处。

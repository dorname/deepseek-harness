# 实现任务

## [delta] 规格变更
- [x] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S55 场景（总览行 + 详述 + 验收条件）及 S26/S03 关联。
- [x] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 §15 会话导出经 ACP 规格（三方法契约、拉式分块与背压、生命周期与错误词表、安全可见性声明、Config 字段）。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 新增 §20 会话导出面与组件职责。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 新增会话导出方法面（wire 契约、错误词表、连接级生命周期、可见性声明、与 HTTP 路由的工件一致性）。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S55-acp-session-export.md` — 新增 S55 导出时序、生命周期状态与边界。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 新增 §十七 发布物、staging 步骤与回滚注意。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md` — 新增导出 staging 验证与 dspm 部署指引。
- [x] 产出 `deltas/test/core-S55-test-cases.md` — 新增 S55 UT/ST 用例及 AC 追溯。
- [x] 产出 `deltas/test/smoke/acp-network-smoke-test-cases.md` — 新增导出冒烟 SMOKE-acp-network-09（纯方法、staging 可执行）。

## [code] 代码实现
- [x] 实现单切片：`dsh-acp` bridge 新增导出模块（`session/export_begin` / `session/export_read` / `session/export_cancel` 三扩展方法注册，与 `session/compact` 同构；owned-session 校验、flush + 根日志预读、per-connection 游标注册表、`ResponseCapacityGate` 拉式分块、canonical base64、eof/cancel/连接 quiesce 三终态即时释放、`data.code` 错误词表 not_found/export_failed/unknown_cursor 净化消息）；`dsh-acp` Config 新增 `exportChunkBytes`（默认 262144，16384–4194304 加载校验）与 `exportCompressionLevel`（0–9 默认 6）；`peerDependencies` 增补可选 `sessionQuery`/`attachments`（`ctx.get` 缺席 fail-loud）。零新增通知类型、零新增会话事件、`SessionEventMap` 与 Session format 4 不变、双 SDK 零改动。交付 UT-S55-01..08（bridge 单测：begin 预读应答/404 语义/分块上限与 base64 规范性/eof 终态交付/cancel 释放/quiesce 清理/未知游标与服务缺席 fail-loud/并发快照独立，含真实 Loader 组合与 HMR dispose 回归）、快照新场景 `snapshots/acp/session-export/`（harness 新增导出 op，结构化断言方法名/参数/响应形状/错误码 wire 契约）、ST-S55-01（acp-network 真实组合：prompt 驱动事件 → begin/read 至 eof → 解包断言 `session.v4.jsonl` 与内容 → cancel/unknown_cursor 路径）、SMOKE-acp-network-09 接入 protocol-smoke.ts 与统一 smoke dispatcher（含账本行与 staging skip 语义）、中英 README（dsh-acp 扩展方法表 + 范围行修订、session-log-export 新消费者注记）+ 升级指南三元组（版本号随发布期定）+ config-catalog 重生成。 — 门禁：typecheck / lint / doc-sync 42/42 PASS；`openlogos verify` Gate 3.6 PASS（pre_run exit=0，247 用例 0 失败 0 未覆盖，覆盖 100%，S55 两 spec 已入 pre-run 清单）；快照 ACP 套件 keyless 23/23（新场景 `session-export` 自持 header 类、复用 permission-policy sidecar、`{{exportChunk}}` 令牌化归档字节）；UT-S55-01..08 8/8（`export.ts` 100% 覆盖：85/85 语句、49/49 分支、14/14 函数）；ST-S55-01 真实 WebSocket 组合绿（acp-network harness 挂载生产 `session-query-sqlite` openAt:never）；SMOKE-acp-network-09 本地全链路绿 + dispatcher 账本行 + staging skip 语义；顺带修复 snapshot harness 首个真实消费者的 `promptAndWaitForAgentMessage`（增量累积匹配 + 有界超时）与 tool-goal 一处 lint 红。环境既有红（stash 基线探针证实与本切片无关）：headless/sdk 快照系统提示词 sidecar 漂移、hygiene constraints/vendor-rescope/no-unknown-casts、duplication 57 clones（基线同值）、coverage 合并分区 24 个环境敏感失败文件（desktop/GIO/文件权限/真实 SDK），本切片触及文件全部通过。

## [deploy] 部署任务
- [ ] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。（人工确认点：需用户明确授权）
- [ ] 验证 ACP 会话内导出往返（begin → read 至 eof → 解包断言）、cancel/unknown_cursor 路径、includeDescendants 语义、既有导出（S26 web 面）与 S49..S54/S03 回归，确认上一版发布物回滚路径（旧构建 methodNotFound，日志回读无损）。（人工确认点：需用户明确授权）

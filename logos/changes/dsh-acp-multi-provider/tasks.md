# 实现任务

## [delta] 规格变更
- [x] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增 S53 场景、验收条件及 S03/S15/S49/S50/S51/S52 关联。
- [x] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 §13 多供应商路由供给形态规格（双键定义、归一化、冲突词表、默认路由语义、dict-vs-数组选型说明）。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/core-system-map.md` — 新增 §18 多供应商路由供给形态与组件职责。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/acp-network-system-map.md` — 新增默认路由选择与多路由广告语义说明（协议面零改动）。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S53-acp-multi-provider.md` — 新增 S53 配置面归一化、冲突矩阵、时序与边界。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 新增 §十五 发布物、配置、staging 步骤与回滚注意（含组合 patch 还原）。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/acp-network-deployment-plan.md` — 新增 staging 验证与 dspm 部署指引。
- [x] 产出 `deltas/test/core-S53-test-cases.md` — 新增 S53 UT/ST 用例及 AC 追溯。
- [x] 产出 `deltas/test/smoke/acp-network-smoke-test-cases.md` — 新增多供应商供给冒烟 SMOKE-acp-network-07。
- [x] 已合并进 `logos/resources/`（openlogos merge 记录见本目录 SPEC_MERGED）；实现期勘误将「providers 节点接受两种形式」的联合措辞对齐为两键命名（`providers` dict + `providerList` 组合专用键），语义不变。

## [code] 代码实现
- [x] 实现单切片：llm-pi-ai 配置新增 `providerList` 数组键（每项 `{ provider 路由键, ...供应商档案 }`，组合专用、settings 写入门拒绝对其写入），`resolveProviderSection` 在配置解析入口归一化进既有 dict 管线（`resolveProfiles`、memoized 快照、`registerAdapter`、可配置目录、模型发现、凭据解析零改动）；`provider` 字段守卫形态上下文感知（dict 值仍拒绝、数组项即路由键）；冲突 fail-loud——两键同供、数组内重复路由键、缺失或空路由键、非法档案条目加载期硬失败并指名路由与来源，settings 供给的 `providers` 与组合供给的 `providerList` 并存按既有冲突语义诊断并保持上一有效路由集；settings 文档保持 dict-only。交付 UT-S53-01..04（config.spec 7 例 / loader-composition.spec 3 例含真实 settings 写拒绝与冲突诊断；UT-S53-03 由既有回归承载）、ST-S53-01（multi-provider.spec：providerList×两 mock HTTP 路由经网络通道的分组广告、默认值对、切换命中与重启 resume 持久）、SMOKE-acp-network-07 接入 protocol-smoke.ts 与统一 smoke dispatcher（本地通道五段断言；staging/handshake 通道按 skip 语义）、llm-pi-ai 中英文 README 与 JSDoc、base bundle cordis.patch.yml 休眠挂载注释更新、config-catalog 重生成、`docs/upgrade-guide/v0.2.1-alpha.1/acp-multi-provider/` 中英文升级指南（双键形态、冲突词表、选型说明、dspm 组合示例、回滚 patch 还原注意）。

## [deploy] 部署任务
- [x] 按合并后的部署方案构建带 commit 标识的 dsh 发布物并部署到 staging。（人工确认点：用户已明确授权 2026-11-08；发布物 355 artifacts @ `2597e763c7`，部署证据见 `logos/resources/verify/s53-deployment-report.md`）
- [x] 验证数组组合的多路由注册、configOptions 分组广告、跨供应商切换与 resume 持久、冲突矩阵诊断，并回归既有 prompt/resume、S49/S50/S51/S52 路径与 dict/settings 供给，确认上一版发布物回滚路径（含组合 patch 还原注意）。Gate 3.8 PASS 20/0/12（含 SMOKE-acp-network-07）；冲突矩阵五分支独立进程实测；回归 94/94；回滚基线 `d6d9167d29`。

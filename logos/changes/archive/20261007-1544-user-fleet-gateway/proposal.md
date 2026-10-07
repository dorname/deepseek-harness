# 变更提案：user-fleet-gateway

> module: core | created: 2026-10-06

## 变更原因

产品当前是单用户形态：Web 认证是「启动令牌 → 会话 cookie」的进程级共享凭证（`docs/user/guide/public-deployments.md` 明示打印的 URL 携带进程凭证、只与预期用户共享），全部用户数据收敛在单一 `$DSH_HOME`。这使 dsh 无法作为团队/组织的自托管多用户运行时使用：任何持令牌者完全等价，跨用户零隔离。

本变更来源于多用户数据隔离目标（G1）的 M1 里程碑，差距分析见 `logos/resources/reference/note/2026-10-06-multi-user-and-cluster-plan.md` §1/§3/§5：以进程级隔离（User Fleet）达成——认证网关（OIDC）+ fleet 管理器 + 每用户独立 dsh Host 进程与独立 `$DSH_HOME`。

## 变更类型

需求级变更（新增场景 S31–S33，全链路：需求 → 设计 → 架构 → 场景时序 → 部署 → 测试 → smoke → 代码）

## 变更范围

- 影响的需求文档：`prd/1-product-requirements/core-01-requirements.md` —「三、场景总览」表追加 S31–S33 行；「四、核心场景详述（P0）」新增 S31/S32 详述；「五、约束与边界 > 5.3 “不做”清单」修订（自托管多用户 fleet 移出不做范围；厂商托管 SaaS 仍不做）
- 影响的功能规格：`prd/2-product-design/1-feature-specs/core-01-feature-design.md` — 新增 fleet 交付面交互规格（网关登录、跨用户隔离验证、进程生命周期管理）
- 影响的业务场景：S31（用户经认证网关登录并进入自己的 Harness，P0）、S32（跨用户数据不可达，P0）、S33（fleet 用户进程生命周期，P1）；`scenario_counter.next_id` 31 → 34
- 影响的架构文档：`prd/3-technical-plan/1-architecture/core-system-map.md` — 新增「fleet 部署形态」章节：gateway / fleet-manager 组件与隔离不变式
- 影响的场景实现：`prd/3-technical-plan/2-scenario-implementation/` — 新增 core-S31 / core-S32 / core-S33 时序文档
- 影响的部署方案：`prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 新增 fleet 部署拓扑、环境变量、构建发布条目、部署后检查清单、冒烟方案条目
- 影响的 API：无（模块 `skip_phases` 含 api；网关是 HTTP 反向代理 + OIDC，不自开业务 API）
- 影响的 DB 表：无（M1 每用户独立 home，物理隔离，无共享库、无迁移）
- 影响的编排测试：无（`skip_phases` 含 scenario）
- 影响的测试用例：`test/core-S31-S33-test-cases.md`（新增）、`test/smoke/core-smoke-test-cases.md`（用例表追加 SMOKE-core-09..11）
- 影响的现有代码面（`[code]` 阶段，切片由 slice-planner 规划）：新增 `dsh-gateway`、`dsh-fleet-manager` 两个组件；小改 web-app 启动（信任 loopback 网关转发头的配置项）、anonymous-user-id（读取 fleet 注入的用户标识用于审计归属）

## 部署影响

- 是否需要部署：是
- 部署原因：fleet 是新增部署形态（网关 + 多用户进程组合），部署方案与 smoke 需同步更新并在 staging 实际验证
- 影响环境：staging（本地 staging 验证环境；本仓无集中服务器，见部署方案 §九）
- 是否涉及数据迁移：否（每用户新建独立 home，无存量数据迁移；既有单用户形态不受影响）
- 是否需要回滚预案：是（停 fleet 管理器、回收用户进程与 homes，即回退到既有单用户形态）
- 是否需要 smoke：是（SMOKE-core-09..11：网关认证、双用户隔离、进程生命周期）
- 资源约束（用户验收要求）：验收测试与冒烟执行期间必须控制 CPU 利用率、不得打爆主机——fleet 并发上限与空闲回收阈值是配置项（staging 验收用小上限），冒烟用例串行执行；该约束落入部署后检查清单、S33 验收条件与 SMOKE-core-11

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

说明：本次不修改 dsh Web 客户端界面。网关的登录页面由外部 OIDC 提供方承载；网关自身对未认证请求仅做重定向，不新增自绘页面。

## 变更概述

新增两个部署侧组件：（1）**dsh-gateway**——OIDC 认证反向代理，按用户路由到其专属 dsh Host 进程的 loopback 端口，现有启动令牌机制原样保留在网关内层，令牌不出本机回环；（2）**dsh-fleet-manager**——为每个首次登录的用户 spawn 一个 `dsh --profile web` 进程并注入该用户专属 `DSH_HOME`，负责空闲回收、崩溃重启与并发上限。核心 dsh 包语义不变；仅两处小改：web-app 启动补「信任 loopback 网关转发头」配置项，anonymous-user-id 支持读取 fleet 注入的用户标识用于审计归属。

隔离边界 = 操作系统进程 + 文件系统目录（每用户独立 home），是 dsh 沙箱哲学的自然延伸。被否决的「进程内多租户」路径及理由记录于方案 note §9；M1 不引入任何共享存储（那是 M2 里程碑）。

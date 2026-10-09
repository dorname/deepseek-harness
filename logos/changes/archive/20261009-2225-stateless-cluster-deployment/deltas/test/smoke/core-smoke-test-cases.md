# delta — core-smoke-test-cases.md（变更 stateless-cluster-deployment）

## MODIFIED — 二、冒烟测试用例

# core: 部署后冒烟测试用例

> 最后更新：2026-10-07
> 来源：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` §八。SMOKE-* 结果写入 `logos/resources/verify/smoke-results.jsonl`（`openlogos smoke` 判定）。

## 一、冒烟测试范围

| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | 健康检查、核心入口、静态资源、配置与密钥、关键链路、日志、fleet 认证与隔离 | launch/发布前必跑；dsh 无集中服务器，staging = 发布验证环境（干净机器或 CI 容器）；fleet 用例按部署配置的小并发上限串行执行 |

## 二、冒烟测试用例



| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-01 | CLI 版本健康检查 | 部署方案 §七.1 | staging | 已安装目标版本 | `dsh --version` | 输出版本号，退出码 0 |
| SMOKE-core-02 | 组合配置可 dump | 部署方案 §七.2 | staging | profile 存在 | `dsh --profile web --dump-config` | 打印组合树退出 0，不启动 Host |
| SMOKE-core-03 | Web 核心入口就绪 | 部署方案 §七.3 | staging | 3080 空闲 | `dsh web --no-open` → GET URL | 打印 URL；HTTP 200；前端 dist index/bundle 可访问 |
| SMOKE-core-04 | 无凭证 fail-loud 引导 | 部署方案 §七.4 | staging | 无 key | `dsh web` 打开设置/发消息 | 出现凭证引导而非崩溃挂起 |
| SMOKE-core-05 | 代理公开路径受信校验 | 部署方案 §八·配置与密钥 | staging | `--public-url --trusted-host` 启动 | 受信 Host 请求 / 非受信 Host 请求 | 受信 200；非受信被拒 |
| SMOKE-core-06 | headless 最小任务链路 | 部署方案 §八·关键链路 | staging | 有 key | `dsh headless "say hi"` | 退出 0 且打印最终答案 |
| SMOKE-core-07 | SDK initialize 握手 | 部署方案 §八·关键链路 | staging | 有 key | TS/Python SDK 最小 run | 返回 final_response，子进程干净退出 |
| SMOKE-core-08 [manual] | Desktop 首启进入工作区 | 部署方案 §七.5 | staging | 安装包已签名 | 安装并首启 | API-key 页或工作区出现；无阻断性错误日志 |
| SMOKE-core-09 | fleet 网关认证与路由 | 部署方案 §八·fleet 认证与隔离 | staging | fleet 部署运行 + OIDC 测试提供方 | 浏览器访问网关 → 完成登录 | 进入该用户专属 Web UI；fleet 日志含 provisioned |
| SMOKE-core-10 | 双用户隔离抽查 | 部署方案 §八·fleet 认证与隔离 | staging | 两个测试用户均已登录 | 用户 B 访问用户 A 的会话 URL | B 得到明确拒绝；A 的列表/数据对 B 不可见 |
| SMOKE-core-11 | fleet 生命周期与资源上限 | 部署方案 §八·fleet 认证与隔离 | staging | fleet 部署运行；CPU 监控开启 | 依次触发空闲回收、崩溃重启、并发上限拒绝（串行执行） | 三个行为均按部署配置生效；全程主机 CPU 峰值 ≤ 部署配置阈值 |
| SMOKE-core-12 | 共享持久层双节点互见 | 部署方案 §七.9 / §八·共享持久层 | staging | 共享 Postgres 运行；两个 dsh Host 实例指向同库 | 节点 A 创建会话并提交 → 节点 B 打开同一用户同一会话 | B 读到与 A 一致的事件与头；串行执行，CPU 峰值 ≤ 部署配置阈值 |
| SMOKE-core-13 | 每用户命名空间互不可见 | 部署方案 §七.10 / §八·共享持久层 | staging | 同上；两实例分别注入不同 fleet subject | A 域写 → B 域读同名键 → B 域写 → A 域读 | 双向均只见自己命名空间的值 |
| SMOKE-core-14 | 执行池崩溃接管续跑 | 部署方案 §七.11 / §八·执行池 | staging | 共享 Postgres 运行；runner A/runner B 进程指向同库 | runner A 执行 turn 中被 kill → 等租约过期 → runner B 接管 | B 在租约过期内接管并接续 inbox 未消费输入，事件序列无重复副作用；串行执行，CPU 峰值 ≤ 部署配置阈值 |
| SMOKE-core-15 | 流中继双副本实时 | 部署方案 §七.12 / §八·执行池 | staging | 同上；runner 与两副本进程 | runner 持续发布帧/事件 → 两副本各自订阅追赶 | 两副本按相同序号收到相同记录；中途订阅从游标完整回放；CPU 峰值 ≤ 阈值 |
| SMOKE-core-16 | 共享 schedule 到期恰一交付 | 部署方案 §七.13 / §八·Host 本地服务 | staging | 共享 Postgres 运行；双 runner 到期派发循环 | 任务到期 → 双 runner 并发取用 | 恰一交付无重复；串行执行，CPU 峰值 ≤ 部署配置阈值 |
| SMOKE-core-17 | webhook 恰一建会话 | 部署方案 §七.13 / §八·Host 本地服务 | staging | 同上；事件经入口入队 | 事件入队 → 消费循环 | 恰一创建 Workspace Session 且会话入执行池队列；CPU 峰值 ≤ 阈值 |
| SMOKE-core-18 | 排空后接管续跑与旧会话可打开 | 部署方案 §七.14 / §八·Host 本地服务 | staging | 同上；双 runner + 排空指令 | A drive 中排空 → turn 边界收尾 → B 接管 | 新工作流向 B；in-flight 会话日志完整可打开；CPU 峰值 ≤ 阈值 |
| SMOKE-core-19 | SIGTERM 优雅排空退出 | 部署方案 §编排器无关原则 / §八·Host 本地服务 | staging | runner 进程以配置化循环运行 | 向进程发 SIGTERM | 停止接新工作；in-flight 到 turn 边界；exit 0；串行执行，CPU 峰值 ≤ 部署配置阈值 |

## 三、覆盖度校验



- [x] 健康检查：SMOKE-core-01/02
- [x] 核心入口：SMOKE-core-03
- [x] 数据库迁移：不适用（模块 skip_phases 声明无数据库）
- [x] 静态资源：SMOKE-core-03
- [x] 配置与密钥：SMOKE-core-04/05
- [x] 关键链路：SMOKE-core-06/07
- [x] 日志与监控：SMOKE-core-08 [manual]（人工查日志）
- [x] fleet 认证与隔离：SMOKE-core-09/10/11（串行执行，CPU 峰值受部署配置阈值约束）
- [x] 共享持久层：SMOKE-core-12/13（双节点串行执行，嵌入式 Postgres 与双实例同时运行时监控 CPU 不超部署配置阈值）
- [x] 执行池：SMOKE-core-14/15（kill-runner 接管续跑与双副本流式实时；runner 操作串行触发，多进程运行时监控 CPU 不超部署配置阈值）
- [x] Host 本地服务：SMOKE-core-16/17/18 + SMOKE-core-19（SIGTERM 优雅排空；串行执行，CPU 不超部署配置阈值）

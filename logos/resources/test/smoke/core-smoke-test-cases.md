# core: 部署后冒烟测试用例

> 最后更新：2026-10-06
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

## 三、覆盖度校验

- [x] 健康检查：SMOKE-core-01/02
- [x] 核心入口：SMOKE-core-03
- [x] 数据库迁移：不适用（模块 skip_phases 声明无数据库）
- [x] 静态资源：SMOKE-core-03
- [x] 配置与密钥：SMOKE-core-04/05
- [x] 关键链路：SMOKE-core-06/07
- [x] 日志与监控：SMOKE-core-08 [manual]（人工查日志）
- [x] fleet 认证与隔离：SMOKE-core-09/10/11（串行执行，CPU 峰值受部署配置阈值约束）

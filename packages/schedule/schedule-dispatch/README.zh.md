---
description: "共享 schedule 派发：到期行存于共享库，经 FOR UPDATE SKIP LOCKED 每次交付恰一取用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule-dispatch

[English](README.md) | 中文

## 摘要

`dsh-schedule-dispatch` 是 schedule 交付的集群形态：到期行存于共享 `schedule_due` 表（每任务一行、`next_due_at` 单调推进），runner 节点运行派发循环——以 `FOR UPDATE SKIP LOCKED` 取最新到期行、取会话租约、交付、推进 next-due,全部在一个事务内，其行锁即恰一取用保证。提交前崩溃回滚该行，提醒绝不丢失；recurring 行跳过整个错过的周期、落在首个严格未来时刻，仅交付最近一次错过的 occurrence。单机 `ScheduleService` 为并列形态：未配置共享库时 Host timer 行为不变。本包只在宿主侧：不贡献 prompt、工具或 schema。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="使用本包"></a>
## 使用本包

runner 节点与会话租约提供方一并挂载本循环；`deliver` 回调恢复会话并追加提醒。

```yaml
plugins:
  '@deepseek-ai/dsh-schedule-dispatch':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_schedule
    nodeId: runner-a
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `connectionString` | 必填 | 共享 schedule 库的 `postgres://` 连接串 |
| `max` | `2` | 连接池大小 |
| `nodeId` | 无（循环必需） | 本 runner 的租约身份 |
| `leaseTtlMs` | `2000` | 交付窗口的租约有效期 |
| `pollMs` | `250` | 等待到期工作时的轮询兜底间隔 |
| `deliver` | 必填 | 交付回调：恢复会话并追加提醒 |

### 可观察行为

全新数据库在一个事务内盖物理布局版本戳；其他已戳版本拒绝——不迁移,预发布立场。每次 occurrence 至少交付一次：抛错回滚取用、下一轮重投。被持有的会话租约让行保持到期状态留给属主。

-----

<a id="模型体验"></a>
## 模型体验

### 集群提醒交付

#### 模型看到什么

无。本包不贡献 prompt、工具或 schema；仅为宿主侧消费方在 Cordis 服务之后交付定时提醒。

#### Token 影响

零 live-request token。

#### KV Cache 影响

无——本包从不触碰活请求前缀。

## 已知限制与待办

- **预发布物理布局**——任何外部戳记的布局版本拒绝而非迁移。
- **仅固定间隔 recurrence**——共享形态承载 `once` 与 `interval:<ms>` 行；daily/weekly/cron 墙钟规则仍是单机 `ScheduleService` 形态。
- **数据库与 schema 必须预先存在**——提供方建表不建库；连接或权限故障在首次使用时浮出。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

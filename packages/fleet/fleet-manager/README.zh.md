---
description: "User Fleet 部署的用户进程管理：独立 home 按需启动、空闲回收、有限崩溃重启及并发上限。"
kind: "package-library"
---

# @deepseek-ai/dsh-fleet-manager

[English](README.md) | 中文

## 概述

为每个认证用户按需启动独立的 `dsh --profile web` 进程，并将数据保存在该用户的 `$DSH_HOME`（`<homesDir>/<subject>`）。空闲进程会被回收，数据保留；崩溃进程在有限滑动窗口内重启。并发上限限制登录可启动的进程数，每次状态转换均输出结构化生命周期事件。部署入口及网关使用本类库管理用户进程。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

每台宿主运行一个 fleet manager。`homesDir` 指向所有用户 home 的根目录，并按部署需求配置以下字段：

| 字段 | 含义 | 默认值 |
|---|---|---|
| `homesDir` | 创建各用户 `$DSH_HOME` 的根目录 | 必填 |
| `dshCommand` | 各用户的启动命令（追加 `--port 0`） | `dsh --profile web` |
| `maxUsers` | 用户进程并发上限；超限登录被拒绝 | 8 |
| `idleRecycleMs` | 回收进程前的空闲时间（保留数据） | 30 分钟 |
| `maxRestarts` / `restartWindowMs` | 滑动窗口内允许的崩溃重启次数 | 3 / 60 秒 |
| `stopTimeoutMs` | 回收升级信号前的 SIGTERM 宽限时间 | 10 秒 |
| `portReadyTimeoutMs` | 等待操作系统分配端口的超时 | 60 秒 |

```ts
import { FleetManager } from '@deepseek-ai/dsh-fleet-manager'

const fleet = new FleetManager({ homesDir: '/data/homes', maxUsers: 4 })
fleet.listActive() // [] until a user process is provisioned
await fleet.dispose()
```

非法主体（不匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`）会抛出异常：主体用于 home 目录名，因此入口必须保证文件系统安全。超限登录返回 `rejected(limit)`，并输出 `rejected` 事件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计说明

- **单一进程管理方。** manager 启动、停止及重启用户进程；网关只观察。
- **按需启动。** 仅为已经登录的用户启动进程，不预先分配。
- **回收保留数据。** 回收停止进程，但保留 `<homesDir>/<subject>`；下次登录使用同一 home 启动，追加写入的会话日志代次保留已有会话。
- **重启上限。** `restartWindowMs` 内的崩溃按主体跨重启累计；超过 `maxRestarts` 后移出登记并输出 `failed` 事件。主动停止（回收或关机）会清除该主体的重启计数。
- **进程启动接口。** `FleetProcess` 表示子进程；生产启动器 `spawnDshWebProcess` 使用 `--port 0`，注入 `DSH_HOME`、`DSH_FLEET_USER_ID`，并在输出回环 URL 后完成启动。

| 文件 | 职责 |
|---|---|
| [`src/config.ts`](src/config.ts) | 配置字段、默认值和校验；`FLEET_SUBJECT_PATTERN` |
| [`src/process.ts`](src/process.ts) | `FleetProcess` 和生产环境 `dsh --profile web` 启动器 |
| [`src/fleet-manager.ts`](src/fleet-manager.ts) | 进程登记、启动、回收、重启、上限和生命周期事件 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 进程启动

#### 模型看到什么

无直接影响。`FleetManager` 管理宿主侧进程，不改变模型请求。

#### Token 影响

不增加请求 token。

#### KV Cache 影响

无；请求前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **单宿主。** 登记保存在进程内；本包不提供共享持久化或跨宿主调度。
- **空闲检测依赖活动标记。** `ensureProcess`/`touch` 更新活动时间；长时间执行且无网关转发的 turn 仍可能在宽限期后被回收。
- **本地信任。** 宿主管理员可访问所有进程与 home；本包不负责管理平面的加固。
- **Windows 未测试。** POSIX 进程语义（SIGTERM 升级、信号崩溃检测）仅在 POSIX 验证；测试不在 Windows 通道运行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

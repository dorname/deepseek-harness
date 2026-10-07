# delta — core-S34-S36-test-cases.md（变更 shared-persistence-backends）

## ADDED — core S34–S36（共享持久层域）— 测试用例

# core S34–S36（共享持久层域）— 测试用例

> 最后更新：2026-10-07
> 来源：变更 `shared-persistence-backends`。场景来源 `core-01-requirements.md` §S34–S36；场景实现见 `core-S34-shared-session-generations.md`、`core-S35-shared-domain-namespace.md`、`core-S36-shared-attachments.md`。

## 资源约束（验收执行，适用于本文件全部 ST 与对应 SMOKE）

- 契约/单元测试用 `@embedded-postgres/linux-x64` 免 root 真实 Postgres 二进制；二进制缺失时相关用例**显式 skip**并输出原因（可见、不假绿），其余用例照常执行。
- 嵌入式 Postgres 与双实例同时运行时按端口/数据目录隔离；ST 串行执行，不并行拉起多套共享库。
- 执行期间监控主机 CPU 利用率，峰值不超过部署配置阈值；超阈视为环境违规，先回收实例再继续，不得带违规定论。

## S34: 共享会话世代的跨节点读写与崩溃恢复

### 1.1 单元/契约测试用例（来源：session-persistence-postgres 契约与私有 spec）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S34-01 | 跨实例互见：新连接读到已提交世代与头 | `runPersistenceContract` 跨实例用例（reopen）+ 私有 spec | 嵌入式 Postgres 运行；实例 A 已提交 ≥1 世代 | 实例 B（新连接）stat/list/open 同一会话 | B 可见该会话且事件/头与 A 提交一致 |
| UT-S34-02 | 中断尾修复：torn tail 不回读、写式打开修复 | `corruptTail` 注入 + 私有 spec | 尾中留半行 JSON | 读打开 / 写式打开 | 读路径屏蔽半行；写式打开截断合成收尾；已提交世代字节不变 |
| UT-S34-03 | 写式互斥：advisory lock 占用与释放续写 | 私有 spec | A 持写式句柄 | B 写式打开；A close 后 B 再开 | B 首次明确占用失败；A 释放后 B 获锁并从已提交 next-seq 续写 |
| UT-S34-04 | 未来格式拒绝 | `assertVersion` 语义 + 私有 spec | 存储中存在高于本节点认知的格式版本 | open | `SessionFormatUnsupportedError` 同族明确拒绝，不留所有权 |
| UT-S34-05 | 独占发布冲突：同名世代恰一胜者 | 私有 spec | 会话当前世代 N | 并发发布世代 N+1 两次 | 恰一成功，另一冲突错误；发布与指针推进同事务 |
| UT-S34-06 | 缝契约套全绿（持久化面） | `runPersistenceContract('postgres', …)` | 嵌入式 Postgres 运行 | 工厂 `{persistence, dispose, reopen, corruptTail}` | 全部行为点通过；跨实例/torn-tail 用例不被跳过 |
| UT-S34-07 | live 写路径契约全绿 | `runLiveWritePathContract('postgres', delay, …)` | 同上 + `SessionStore` 挂载 | `{ctx, remount}` | 批窗路由、失败重放、drain/close 语义与 JSONL 一致 |
| UT-S34-08 | 二进制缺失显式 skip | spec 装配层 | Postgres 二进制不可用 | 触发装配 | 显式 skip 并输出原因，不产生假绿 |

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S34-01 | 双节点互见（S34-AC-01） | 主路径 | 嵌入式共享 Postgres 运行；两后端实例（模拟两节点） | A 创建会话并 flush 物化 → B stat/list/open | B 看到会话，事件与头与 A 一致 |
| ST-S34-02 | 崩溃恢复（S34-AC-02） | 异常流 | A 写式打开写入中 | 强制丢弃 A 实例（不留尾终止符）→ B 打开 | B 读不到中断尾；下一次写式打开完成修复；世代字节不变 |
| ST-S34-03 | 写式互斥（S34-AC-03） | 异常流 | A 持写式句柄 | B 写式打开 → A close → B 重试 | B 得到明确占用失败；A 释放后 B 成功且无双写者 |

## S35: 共享域数据的每用户命名空间

### 1.1 单元测试用例（来源：storage-domain 提供方派生与 storage-postgres）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S35-01 | 命名空间互不可见：同键独立值 | storage-domain 派生 + postgres 后端 spec | 两个不同 subject 的 DomainFacility 实例指向同一库 | A put(k,v1)；B get(k) → B put(k,v2) | B 读到 v2 不读 v1；物理层为两组互不相干的表 |
| UT-S35-02 | 单机默认命名空间行为不变 | 同上 | 未注入 `DSH_FLEET_USER_ID` | 域 open/put/get | 走原名 unit，行为与既有本地后端一致 |
| UT-S35-03 | 键空间闭合：无跨命名空间寻址 | 同上 | A 已注入命名空间 | A 经域 API 以 B 的键名读写 | 读写落在 A 自己命名空间，触达不到 B 的数据 |
| UT-S35-04 | 派生名确定、合法、冲突 loud fail | 派生函数 spec | 固定 subject | 同 subject 重复派生 / 构造碰撞 | 派生名确定且满足 `UNIT_NAME_RE`；检出冲突时明确失败不合并数据 |
| UT-S35-05 | global 槽位按用户分离 | postgres 后端 + 派生 spec | A、B 各自命名空间 | A setGlobal(g1)；B setGlobal(g2) | 各读各的 global，互不覆盖 |

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S35-01 | 双进程同库互不可见（S35-AC-01） | 主路径 | 嵌入式共享 Postgres；两进程分别注入不同 subject | A 域写 → B 域读同名键 → B 域写 → A 域读 | 双向均只见自己命名空间的值 |

## S36: 附件与溢出的共享存取

### 1.1 单元测试用例（来源：attachment-postgres / spill-postgres spec）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S36-01 | 图像存取一致且引用不透明 | `AttachmentStore` 后端 spec | 共享库运行 | saveImage(bytes) → readImage(ref) | 字节逐字节一致；ref 为不透明内容寻址 id |
| UT-S36-02 | 缺失键明确 not found | 同上 | 库中无该引用 | readImage(未知 ref) | 明确 not found 失败，不返回空字节 |
| UT-S36-03 | 校验拒绝：超限与非法字节 | `imageLimits`/`validateImage` 语义 | 共享库运行 | 超限图片/非法字节 | 保存拒绝并返回错误事实 |
| UT-S36-04 | 溢出存取与 owner 约束 | `SpillStore` 后端 spec | 共享库运行 | saveText(owner, text) → 按 ref 取回；缺 owner 输入 | 取回文本一致；缺 owner 明确拒绝 |
| UT-S36-05 | 命名空间隔离：跨属主不可达 | 后端 spec | A、B 两命名空间 | A saveImage → B 以 A 的引用读取 | B 读不到 A 的对象（not found） |

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S36-01 | 跨节点取回一致（S36-AC-01） | 主路径 | 共享库运行；两实例同一命名空间 | A saveImage → B readImage（同一引用） | 字节逐字节一致 |
| ST-S36-02 | 溢出跨节点取回 | 主路径 | 同上 | A saveText → B 按 ref 取回 | 文本一致 |

## 覆盖度校验

- [x] S34 P0 验收条件：正常+异常均 ≥1 用例；`runPersistenceContract`/`runLiveWritePathContract` 契约绑定显式成用例（UT-S34-06/07）
- [x] S35 P0 验收条件：正常×2 + 异常 ≥1 用例；global 分离与派生合法性单独成用例
- [x] S36 P1：主路径 + 异常路径 ≥1 用例
- [x] 资源约束：本文件资源约束节 + 部署检查清单第 8/9/10 条 + SMOKE-core-12/13 一致

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S34-AC-01 | 正常：双节点互见 | ST-S34-01, UT-S34-01, UT-S34-06 |
| S34-AC-02 | 正常：崩溃恢复 | ST-S34-02, UT-S34-02 |
| S34-AC-03 | 异常：写式互斥 | ST-S34-03, UT-S34-03 |
| S34-AC-04 | 异常：未来版本拒绝 | UT-S34-04 |
| S35-AC-01 | 正常：命名空间互不可见 | ST-S35-01, UT-S35-01, UT-S35-05 |
| S35-AC-02 | 正常：单机行为不变 | UT-S35-02 |
| S35-AC-03 | 异常：域 API 不暴露跨命名空间寻址 | UT-S35-03, UT-S35-04 |
| S36-AC-01 | 正常：跨节点取回一致 | ST-S36-01, ST-S36-02, UT-S36-01 |
| S36-AC-02 | 异常：缺失键明确报错 | UT-S36-02, UT-S36-05 |

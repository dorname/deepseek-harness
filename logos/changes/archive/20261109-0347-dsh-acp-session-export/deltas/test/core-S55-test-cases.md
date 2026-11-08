# core S55（外部客户端经 ACP 流式拉取会话导出）— 测试用例

> 来源：变更 `dsh-acp-session-export`。场景来源 `core-01-requirements.md` §S55；场景实现见 `core-S55-acp-session-export.md`。
> 导出字节含时间戳等易变内容——快照场景 `snapshots/acp/session-export/`（harness 新增导出 op）断言 wire 契约结构（方法名/参数/响应形状/错误码）而非字节；字节级工件断言由单元与 ST 以解包比对承载。生产者行为（分块、代理对、背压、取消终止）由既有 `archive.host.spec.ts` 套件回归，本变更零改动该包。

## S55: 外部客户端经 ACP 流式拉取会话导出

### 单元与组件（UT）

| ID | 名称 | 对象 | 前置 | 操作 | 期望 |
|----|------|------|------|------|------|
| UT-S55-01 | begin 正常路径与前置应答 | bridge 导出模块（真实 Loader 组合） | 已驱动事件的 owned 会话；活/冷两种形态 | `export_begin` | 活会话先 flush（日志含最新事件）；返回 `{ exportId, filename }`（`dsh-session-<id>.zip` 命名）；根缺失时 `not_found` 且无游标建立；服务缺席 internal error fail-loud——全部在任何字节交付前 |
| UT-S55-02 | read 分块、eof 与游标终态 | bridge 导出模块 | 在途游标，`exportChunkBytes` 调小 | 循环 `export_read` 至 eof | 每次 `data` base64 解码后 ≤ chunkBytes 且为 canonical 编码；eof:true 为最后交付（其后游标失效 → `unknown_cursor`）；解包字节与 `streamSessionLogZip` 直产字节一致 |
| UT-S55-03 | cancel 释放与不可复活 | bridge 导出模块 | 在途游标 | `export_cancel` → read/cancel | cancel 返回 `{}`、生产者中止；后续 read/cancel 均 `unknown_cursor`；无残留游标 |
| UT-S55-04 | 未知会话与未知游标 | bridge 导出模块 | 无关连接/伪造 id | 未知 sessionId begin；伪造游标 read/cancel | invalid params，无存在性泄漏（未知会话与未知游标消息形态一致化）；第三方法互不越权 |
| UT-S55-05 | not_found 与 export_failed 净化 | bridge 导出模块 | 持久层移除的 owned 会话；血缘后代缺失 fixture | begin；read 至失败点 | `not_found` / `export_failed`（`data.code`）；消息不含主机路径；失败后游标删除 |
| UT-S55-06 | 并发快照独立与 quiesce 清理 | bridge 导出模块 | 同会话两游标；及 dispose 挂载 fiber | 交错 read 两游标；dispose 连接 | 两快照独立推进（各自字节流完整）；dispose 后全部游标 abort、注册表清空、后续调用干净失败 |
| UT-S55-07 | Config 校验与 includeDescendants 语义 | dsh-acp Config schema + 导出模块 | 越界值；有/无子代理会话 | 加载校验；两种 begin | 越界（<16384 / >4194304 / 非法压缩级别）加载即失败指名字段；`includeDescendants=false` 仅根日志条目、true 含 `subagents/`（布局与 HTTP 路由一致） |
| UT-S55-08 | 既有方法面与 HMR 回归 | bridge 全实现表 | S49..S54 既有方法；dispose 挂载 fiber | 既有方法聚焦回归；dispose | 既有方法行为不变；导出资源随 fiber 释放、重复注册拒绝（connection.fetch.register 同级语义） |

### 场景（ST）

| ID | 名称 | 关联 AC | 前置 | 操作 | 期望 |
|----|------|---------|------|------|------|
| ST-S55-01 | 会话导出 ACP 全链路 | S55-AC-01/02/03/04 | 真实 Loader 组合的 acp-network 会话（mock 模型驱动事件） | prompt 驱动事件 → begin → read 循环至 eof → 写文件解包断言 → cancel 与 unknown_cursor 路径 → 回归既有方法面 | 归档布局与 HTTP 同工件（`session.v4.jsonl` 首条目含驱动期事件）；分块上界、eof 终态、cancel/unknown_cursor 词表全符合；web 导出 HTTP 面不受影响 |

### 回归与真实验收

- 复用既有 `archive.host.spec.ts` 全套（生产者零改动回归）：分块、代理对边界、背压等待、取消终止、fail-loud。
- 复用 UT-S49..S54 既有面与 ST-S03-01/02：既有方法注册与通知派发不受第三组扩展方法影响。
- 复用 ST-S52-01 组合面（真实 API 压缩）聚焦复跑：证明新增方法注册不扰动压缩派发链。
- SMOKE-acp-network-01..08 既有回归；SMOKE-acp-network-09 是 S55-AC-01/02 真实部署面的计划用例（纯方法调用无交互握手，staging 具备条件即执行，不满足时按 skip 语义如实记录，不得伪报 PASS）。

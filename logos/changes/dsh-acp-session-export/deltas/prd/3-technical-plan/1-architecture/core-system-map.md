# delta — core-system-map.md（变更 dsh-acp-session-export）

## ADDED — §20 会话导出面（S55）

在 §19 之后（文档末尾）插入：

```markdown
## 20. 会话导出面（S55）

会话导出的生产者集中在 session-log-export 一处，桥接只是传输消费者——零生产逻辑复制：

| 组件 | 职责 | 关键锚点 |
|------|------|----------|
| `session-log-export`（生产者，零改动） | ZIP 字节流生产者：flush、根日志预读、血缘后代枚举、附件内联/流式、fflate 分条 DEFLATE、`ResponseCapacityGate` 背压、取消 terminate | `archive.ts:347`（entries 生成器）、`archive.ts:545`（streamSessionLogZip）、`archive.ts:416-446`（容量门） |
| `acp`（bridge，消费新增） | 三扩展方法注册、owned-session 校验、per-connection 游标注册表、分块拉取与 canonical base64、错误词表、Config 校验 | `bridge.ts` 实现表（`session/compact` 同构）、新导出模块 |
| `attachment`（服务，零改动） | `readImage`（校验内联）/ `readFileStream`（背压流式）被生产者经 ctx.get 消费 | `attachment/src/index.ts:167/:219` |
| `session-query`（服务，零改动） | `traceSession` 血缘枚举被生产者经 ctx.get 消费 | session-log-export deps（`archive.ts:43-56`） |

工件不变量：ACP 导出与 HTTP `/api/session.export` 是同一生产者的同一工件（根日志 + 血缘 subagent 日志 + 附件，`includeDescendants` 语义一致）——两条传输面共享全部行为契约（分块、代理对安全、fail-loud、取消无截断），差异仅在鉴权（browser-auth vs 连接级 owned-session）与分块承载（chunked 响应 vs base64 read 序列）。
```

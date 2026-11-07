# delta — core-system-map.md（变更 dsh-acp-compaction）

## ADDED — §17、ACP 会话压缩入口（S52）

在 §16（ACP 计划模式入口）之后追加：

```markdown
## 17. ACP 会话压缩入口（S52）

| 组件 | 位置 | 职责 |
|---|---|---|
| CompactionEngine | `packages/compaction/compaction/src/index.ts` | 既有压缩服务定义：`compactNow` 空闲维护相位认领、`compaction/start` 持久锁、六失败码闭联（`ManualCompactionError`）、FIFO prompt 排队 |
| 压缩后端 | `packages/compaction/compaction-basic/src/index.ts` | 既有实现：压力/overflow 自动触发、checkpoint 摘要、shadow 替换与缓存复用；本变更不改动 |
| 既有命令通道 | `packages/compaction/command-compact/src/index.ts` | 不变：`/compact` 命令保留（六码 → 人类文本映射先例） |
| ACP bridge 扩展方法 | `packages/acp/acp/src/bridge.ts` | 新增 `session/compact`：归属校验 → 自铸 CommandId → `compactNow` 转发 → 成功统计响应 / 六码 data.code 错误映射；initialize 捕获 clientCapabilities |
| ACP 会话事件派发 | `packages/acp/acp/src/session.ts` | 新增 `compaction/start` / `compaction/end` → `compaction_update` 派发（capability 门控，summary 取前置 `compaction/summary` 事件内容块） |

- ACP 1.4.0 无压缩请求标准方法：`session/compact` 以 SDK 扩展方法注册（原始方法名 + 参数解析器），扩展属性在 ACP README 与升级指南明示。
- 包装语义零复制：引擎契约（空闲相位、持久锁、FIFO 排队、六失败码、失败留痕）原样复用，`/compact` 的映射先例延展为 `data.code` + 人类文本。
- 通知 capability 门控：未声明 `session.compaction` 的客户端零通知（UNSTABLE 面不泄露）；声明者由持久事件派生 in_progress/completed/failed，bridge 不合成事件；`cancelled` 仅在同步错误 data.code。
- 压缩服务缺席 fail-loud（internal error 类），不静默降级；自动触发策略与 `/compact` 命令不变。
- 零持久化面变更：复用 S15 既有 `compaction/*` 事件，`SessionEventMap` 不变，Session format 维持 4。
```

# delta — acp-network-system-map.md（变更 dsh-acp-compaction）

## ADDED — 会话压缩方法面（S52）

在「计划模式方法面（S51）」一节之后追加：

```markdown
## 会话压缩方法面（S52）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，压缩以 bridge 扩展方法注册，通知经既有 `session/update` 通道按 client capability 门控派发，不需要新增网络路由或 dspm 侧协议复制。

```text
│ ACP client (dspm)                           │ ACP server (bridge)                        │
│ initialize（clientCapabilities.session.     │ 捕获能力声明（决定 compaction_update        │
│   compaction: {}）────────────────────────▶ │  派发开关）                                │
│ session/compact { sessionId } ────────────▶ │ 归属校验 → 自铸 CommandId →                │
│                                             │ compactNow（空闲相位，FIFO 排队新 prompt） │
│ ◀──────── { result: {compactionId,          │ 成功：统计 + 摘要块；null：无可压缩历史     │
│            summarySeq, shadowedCount,       │                                            │
│            shadowedTokenCount, summary] }   │                                            │
│ ◀──────── error { data.code: busy|... }     │ 六失败码经 data.code + /compact 人类文本   │
│ ◀─ session/update: compaction_update ────── │ compaction/start|end 持久事件派生          │
│    （in_progress / completed / failed）     │ （仅声明 compaction 能力的客户端）          │
```

- 错误词表：`busy`（已有压缩或代理非空闲）/ `cancelled`（caller 取消或会话收尾中断）/ `changed`（选择段变化，尝试留痕）/ `summary`（摘要不可用）/ `commit`（提交未干净完成）/ `persistence`（完成但未保存）——经 internal error `data.code` 携带，message 复用 `/compact` 人类文本；未知会话与空参 invalid params；服务缺席 internal error（fail-loud）。
- 通知派发：仅 `clientCapabilities.session.compaction` 声明者收到；由持久事件派生（start → in_progress、end 无错 → completed 含前置 summary 事件块、end 带错 → failed 含错误文本），bridge 不合成；`cancelled` 与 `compaction_summary_chunk` 不经通知表达。
- 压缩期间新 prompt FIFO 排队并在维护结算后启动（引擎既有语义）；压缩是持久事务，失败尝试留痕日志。
- 既有 `session/request_permission` 回环、configOptions 面、prompt/resume、审批策略、技能枚举与计划模式行为不受影响。
```

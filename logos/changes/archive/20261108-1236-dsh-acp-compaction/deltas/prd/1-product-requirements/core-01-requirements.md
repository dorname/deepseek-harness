# delta — core-01-requirements.md（变更 dsh-acp-compaction）

## MODIFIED — 三、场景总览（表格追加一行）

在场景总览表 S51 行后追加：

```markdown
| S52 | 外部客户端触发会话压缩并感知压缩生命周期 | 外部 ACP 客户端调用压缩方法并（声明能力时）接收压缩更新 | P01/P08 | P1 |
```

## ADDED — 四、核心场景详述：S52

在 §四 S51 小节之后、"## 五、约束与边界" 之前插入：

```markdown
### S52: 外部客户端触发会话压缩并感知压缩生命周期

- **触发条件**：外部 ACP 客户端（如 dspm）调用 `session/compact` 触发显式压缩替代「摘要续接」兜底；或声明 `session.compaction` 客户端能力后，经 `session/update` 的 `compaction_update` 感知手动与自动压缩的 in_progress / completed / failed 生命周期。
- **用户价值**：dspm 获得原生压缩语义（同会话 shadow 替换、KV 缓存复用、自动压力触发同源），不再以跨会话摘要搬运近似；声明能力的客户端首次获得自动压缩的客户端面（今日纯 log-only）（← P01/P08）。
- **优先级**：P1
- **主路径**：客户端 `session/compact { sessionId }` → bridge 校验归属 → 引擎经空闲维护相位执行压缩（`compaction/start` 锁至 `compaction/end` 的持久事务，期间新 prompt FIFO 排队）→ 成功响应 `{ result: { compactionId, summarySeq, shadowedCount, shadowedTokenCount, summary } }`；无可压缩历史返回 `{ result: null }`。失败经 JSON-RPC internal error `data.code` 携带 busy / cancelled / changed / summary / commit / persistence 六码之一。压缩事件提交时向声明能力的客户端派生 `compaction_update`。
- **边界**：扩展方法（ACP 1.4.0 无压缩请求标准方法，文档明示）；六码为闭联类型属性经 `data.code` 携带，`cancelled` 仅出现在同步错误（日志 end+error 不区分类别，不派生 cancelled 通知）；`compaction_summary_chunk` 不发送（摘要整段落日志）；区域选择、保留策略、摘要生成与自动触发阈值全部复用引擎部署配置，bridge 不新增策略；`/compact` 命令与自有 UI 通道不变；压缩服务未组装的自定义 profile fail-loud（internal error）；`compaction/prune` 不派生通知；零持久化面变更（复用 S15 既有 `compaction/*` 事件）。
```

## ADDED — 四、S52 验收条件

接在 S52 边界段之后：

```markdown
#### 验收条件
##### 正常：显式压缩同步往返
- **GIVEN** 会话存在可压缩历史（真实模型产出的消息历史）
- **WHEN** 客户端调用 `session/compact`
- **THEN** 响应携带 compactionId、summarySeq、shadowedCount、shadowedTokenCount 与摘要内容块；会话日志含 `compaction/start` / `compaction/summary` / `compaction/end` 三元组且 `sourceCommandId` 为 bridge 自铸 id；resume 后压缩生效（表面替换保留）
##### 正常：无可压缩历史
- **GIVEN** 会话历史不足（无安全可压缩区间）
- **WHEN** 客户端调用 `session/compact`
- **THEN** 合法返回 `{ result: null }`（非错误），会话日志无压缩事件
##### 正常：能力声明客户端的压缩通知
- **GIVEN** 客户端 initialize 声明 `clientCapabilities.session.compaction`
- **WHEN** 任意压缩（手动或自动）提交 `compaction/start` 与 `compaction/end`
- **THEN** 客户端经 `session/update` 收到 in_progress 与 completed（含摘要块）或 failed（含错误文本）的 `compaction_update`；未声明能力的客户端零通知
##### 异常：busy 与错误分支
- **GIVEN** 压缩进行中再次调用，或客户端取消请求，或部署未组装压缩服务
- **WHEN** `session/compact`
- **THEN** 竞态调用返回 `data.code: 'busy'`；取消返回 `cancelled`；服务缺席返回 internal error 且说明缺装配、不静默降级；未知会话与空参返回 invalid params 类错误
##### 回归：既有通道与会话行为
- **GIVEN** S03、S15、S49、S50、S51 既有会话与 dsh 自有 UI 压缩通道
- **WHEN** 执行 ACP 主链路、`/compact` 命令、审批策略、技能枚举、计划模式回归
- **THEN** 既有行为保持；`/compact` 命令与自动触发策略不变；既有 ACP 方法请求/响应结构不变
```

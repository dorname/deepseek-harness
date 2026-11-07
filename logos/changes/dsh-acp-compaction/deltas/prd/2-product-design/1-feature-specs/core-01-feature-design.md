# delta — core-01-feature-design.md（变更 dsh-acp-compaction）

## ADDED — §12、会话压缩交互规格（S52）

在 §11（计划模式交互规格）之后追加：

```markdown
## 12. 会话压缩交互规格（S52）

### S52: 外部客户端触发会话压缩并感知压缩生命周期 — 方法与字段规格

**方法**：`session/compact`，bridge 扩展方法（ACP 1.4.0 无压缩请求标准方法，方法名与字段为 dsh 扩展，文档明示）。请求 `{ sessionId }`，无压缩参数（与 `/compact` 无参语义一致，区域选择与保留策略全部由引擎部署配置决定）。成功响应 `{ result }`：`null` 表示无可压缩历史（合法、非错误）；对象形态为 `{ compactionId, summarySeq, shadowedCount, shadowedTokenCount, summary }`——统计与摘要内容块，不暴露内部 seq 区间与逐节点清单。

**失败映射**：六失败码为 `ManualCompactionError.code` 闭联类型属性，经 JSON-RPC internal error 的 `data: { code }` 携带，message 复用 `/compact` 的人类可读文本——`busy`（已有压缩或代理非空闲）/ `cancelled`（调用方取消或会话收尾中断）/ `changed`（选择段提交前变化，尝试留痕日志）/ `summary`（摘要不可用）/ `commit`（提交阶段未干净完成）/ `persistence`（压缩完成但会话未保存）。未知会话与空参走扩展解析器（invalid params）；压缩服务缺席 internal error（fail-loud，说明缺装配）。caller 取消（JSON-RPC 请求取消或客户端断连）映射 `cancelled`。

**能力门控通知**：bridge 在 initialize handler 捕获 `clientCapabilities`；`session.compaction` 在场的客户端按持久事件派生 `compaction_update`（经既有 `session/update` 通道与输出队列排序）——`compaction/start` → `{ compactionId, status: 'in_progress' }`；`compaction/end` 无 error → `completed` 且 summary 取同一 compactionId 前置 `compaction/summary` 事件的内容块；`compaction/end` 带 error → `failed` 且 error 取事件文本。手动与自动压缩共用该派发（声明能力的客户端由此首次看到自动压缩生命周期）。`cancelled` 状态不经通知表达（日志 end+error 不区分类别，bridge 不合成事件）；`compaction_summary_chunk` 不发送（dsh 摘要整段落日志，无增量块）；`compaction/prune` 不派生通知。

### 边界与语义明示

- **引擎语义零复制**：空闲相位经 `runMaintenance` 认领（活跃 turn 或进行中维护 → `busy`）、压缩期间新 prompt FIFO 排队、`compaction/start` 持久锁、失败尝试留痕——全部是引擎既有契约，bridge 只做转发与映射。
- **自有 UI 通道不变**：`/compact` 命令、自动触发策略（压力阈值部署配置所有）、web 投影均不受影响。
- **零持久化面变更**：`compaction/*` 事件自 S15 存在；本变更不新增事件类型，Session format 维持 4。
- **UNSTABLE 属性**：`compaction_update` 在 ACP 1.4.0 标注 UNSTABLE；capability 门控使未声明客户端完全不受影响，dspm 对通知形态的答复只决定其客户端是否声明能力。

### 验收条件（交互级）

##### 正常：同步压缩往返
- **GIVEN** 有可压缩历史的会话调用 `session/compact`
- **WHEN** 压缩完成
- **THEN** 响应含统计与摘要块；日志三元组 sourceCommandId 为 bridge 自铸 id；resume 后压缩生效
##### 正常：能力门控通知
- **GIVEN** 声明与未声明 `session.compaction` 的两类客户端
- **WHEN** 压缩事件提交
- **THEN** 声明者收到 in_progress 与终态更新（completed 含摘要 / failed 含错误），未声明者零通知
##### 异常：busy、取消与服务缺席
- **GIVEN** 压缩中竞态调用、caller 取消、压缩服务缺席
- **WHEN** `session/compact`
- **THEN** 分别返回 data.code busy / cancelled 与 internal error 缺装配说明，均不静默降级
##### 回归：既有面不变
- **GIVEN** 既有 ACP 客户端与 dsh 自有 UI
- **WHEN** 执行 S03/S15/S49/S50/S51 回归
- **THEN** 既有方法结构不变、`/compact` 命令与自动策略不变、压缩通知不泄露给未声明客户端
```

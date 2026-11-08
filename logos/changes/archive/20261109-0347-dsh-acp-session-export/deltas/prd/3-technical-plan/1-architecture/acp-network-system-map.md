# delta — acp-network-system-map.md（变更 dsh-acp-session-export）

## ADDED — 会话导出方法面（S55）

在「默认路由选择与多路由广告语义（S53）」节之后（文档末尾）插入：

```markdown
## 会话导出方法面（S55）

网络 ACP 与 stdio ACP 共用 `AcpBridge`，导出以 bridge 扩展方法三件套承载——拉式分块读取，无通知流、无 capability 要求，两条传输面零差异。

```text
│ ACP client (dspm)                           │ ACP server (bridge)                        │
│ session/export_begin { sessionId,           │ 归属校验 → flush 活日志 → 预读根日志       │
│   includeDescendants? } ─────────────────▶  │ （缺失 → data.code not_found，零字节应答） │
│ ◀──────── { result: { exportId, filename } }│ per-connection 游标：reader + abort        │
│ session/export_read { exportId } ─────────▶ │ reader.read() → 聚合 ≤ chunkBytes → base64 │
│ ◀──────── { result: { data, eof } }  ×N     │ ResponseCapacityGate 门控；eof 即删游标    │
│ session/export_cancel { exportId } ───────▶ │ abort（zip.terminate）→ 游标即删           │
│ ◀──────── { result: {} }                    │ 连接 quiesce → 全部游标 abort + 清空       │
```

- wire 契约：三方法 params/response 如上；`data` 为 canonical base64（每 read ≤ `exportChunkBytes` 原始字节，默认 256 KiB，base64 膨胀 4/3）；`eof: true` 为终态交付（`data` 可空），其后游标失效。
- 错误词表（`data.code`，消息净化不回显主机路径）：`not_found`（根日志缺失）/ `export_failed`（流中失败，如血缘后代缺失）/ `unknown_cursor`（未知或已终结游标，read 与 cancel 一致）；未知 sessionId invalid params、服务缺席 internal error（S52 同构 fail-loud）。
- 生命周期：终态恰四个（eof 交付 / 流中失败 / 显式 cancel / 连接 quiesce），终态即删、无 TTL；同一会话并发多快照合法（独立时间点快照，begin 时刻语义）；`session/close` 不中止在途导出（快照自洽）。
- 安全可见性：连接级 owned-session 为授权边界；交付完整原始会话日志 + 附件字节（严格多于投影 wire 视图）——与浏览器用户经 `/api/session.export`（browser-auth）同级信任、同工件；规格与升级指南显式声明，无脱敏选项。
- 既有方法面（prompt/resume、configOptions、审批策略、技能枚举、计划模式、压缩、goal 授权卡）与 `session/request_permission` 回环不受第三组扩展方法注册影响；部署旋钮为 dsh-acp Config `exportChunkBytes`（16384–4194304，越界加载失败）与 `exportCompressionLevel`（0–9）。
- dspm 部署指引：无 capability 声明，普通请求序列即可（begin → read × N → eof；中止用 cancel）；消费形态 = 字节流写文件 + 标准 unzip（布局与 web 下载一致）；导出含内部事件与 subagent 日志，镜像侧按完整归档对待；未部署导出方法的服务器返回 methodNotFound，客户端可据 capability-free 探测降级到自建镜像。
```

# delta — acp-network-deployment-plan.md（变更 dsh-acp-session-export）

## ADDED — 会话导出入口发布（S55）

在「goal 授权卡（S54）」小节之后（文档末尾）追加：

```markdown
### 会话导出（S55）

- 发布物包含 bridge 导出三方法（`session/export_begin` / `session/export_read` / `session/export_cancel`）与 dsh-acp 两个新 Config 键（`exportChunkBytes` 默认 262144、`exportCompressionLevel` 默认 6，均加载期校验）；端口暴露、Service/Ingress、NetworkPolicy、Token Secret 注入与探针均不变。
- staging 验证在既有本地流程（`pnpm -F @deepseek-ai/dsh-acp-network smoke` + `dsh --profile acp-network`）之外，增加导出面验证：
  1. 有效 token 连接后 `session/new`，mock/真实模型 prompt 产事件，`export_begin { sessionId }` → `export_read` 循环至 eof → 解包断言 `session.v4.jsonl` 首条目含驱动期事件（SMOKE-acp-network-09；纯方法调用无交互握手，staging 具备条件即执行）。
  2. `export_cancel` 后 read 核对 `data.code: 'unknown_cursor'`；伪造游标 id 的 read/cancel 同词表；未知会话 id begin 得 invalid params。
  3. `includeDescendants: true` 的导出核对 `subagents/` 条目（有子代理会话时）；无子代理会话核对仅根日志。
  4. Config 越界值（如 `exportChunkBytes: 1024`）独立进程启动，记录加载失败。
  5. 回归既有 prompt/resume、审批策略（S49）、技能枚举（S50）、计划模式（S51）、压缩面（S52）、多供应商（S53）、goal 授权卡（S54）与 web 导出 HTTP 面（S26）。
- 回滚方案不变（disabled route / 缩容 / 轮换 secret）；本变更零新增持久化数据，导出只读会话日志，回滚无迁移；旧构建上导出方法 methodNotFound。
- relay 侧实现不需要为 S55 增加新语义：三方法均为普通 JSON-RPC 帧（响应体较大——每 read 至多约 341 KiB base64 帧，relay/代理的消息大小上限需覆盖，WS 默认 100 MiB 足够），透传即可。
- dspm 侧指引：无 capability 声明，普通请求序列消费（begin → read × N 至 eof；中止用 cancel）；字节流写文件 + 标准 unzip，布局与 web 下载一致（`session.v4.jsonl` / `subagents/` / `media/` / `files/`）；导出含完整原始日志（内部事件、工具输出、subagent 日志与附件字节），镜像侧按完整归档对待；自建镜像可在该面可用后退役。
```

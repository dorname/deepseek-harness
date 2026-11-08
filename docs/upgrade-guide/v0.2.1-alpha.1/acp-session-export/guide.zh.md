---
kind: upgrade-guide
description: "ACP 新增拉式会话导出三元组——session/export_begin、session/export_read 与 session/export_cancel——流式交付与 HTTP 下载路由相同的 ZIP 归档。"
---

# ACP 会话导出

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-acp` 新增三个 dsh 扩展方法（ACP 1.4.0 未定义导出界面），纯增量、无需方法发现：

- `session/export_begin { sessionId, includeDescendants? }` 打开会话日志的时点快照——先刷新活跃事件——应答 `{ exportId, filename }`，文件名为规范的 `dsh-session-<sessionId>.zip`。`includeDescendants: true` 追溯会话谱系，把每份后代日志置于 `subagents/<id>/` 之下。相同输入下归档字节与 HTTP `/api/session.export` 下载完全一致。
- `session/export_read { exportId }` 拉取下一分块：`{ data, eof }`，data 为配置上限内的 canonical base64，只有生产者耗尽后才送达 `eof: true`。读取节奏即生产节奏，慢消费者不会被 overrun。
- `session/export_cancel { exportId }` 立即释放游标并应答 `{}`。

`data.code` 错误词表：`not_found`（根日志无可导出内容；在任何字节送达前应答）、`export_failed`（流中生产者失败；消息为净化的固定文案）、`unknown_cursor`（游标 id 未知或已终态；随 `Invalid params`）。未知会话 id 使 `export_begin` 以 `Invalid params` 失败。未组合 session-query、session-persistence 或 attachment 服务的组合以 internal error 失败并点名列出缺失的包。

插件新增 Config 字段：`exportChunkBytes`（默认 262144，加载时校验 16384–4194304 区间）与 `exportCompressionLevel`（0–9，默认 6）。不引入新通知类型、会话事件、`SessionEventMap` 成员或 SDK 类型：三元组对会话日志不可见，因此 `session/close` 不中止进行中的导出，同一会话的并发快照相互独立。

## 迁移

1. 采用方客户端：调用 `export_begin`，循环 `export_read` 直至 `eof`，解码并拼接 base64 分块，解压即得归档。断连或重启只需重新 begin——快照是时点性的，不跨进程可续传。
2. 拒绝未知方法的客户端行为不变；三元组从不主动通知。回滚到旧构建时三个方法以 `Method not found`（-32601）应答。
3. `cordis.yml` 无需变更；部署者可在 `acp` 插件 config 下固定 `exportChunkBytes` / `exportCompressionLevel` 以调整分块大小或归档体积。
4. 确认：在一个 ACP 会话中运行一次 prompt，然后 `export_begin` 并读取至 `eof`——解压后的归档包含承载该 prompt 事件的 `session.v4.jsonl`。

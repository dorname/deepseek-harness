---
kind: upgrade-guide
description: "ACP gains a pull-based session export trio — session/export_begin, session/export_read, and session/export_cancel — that streams the same ZIP archive as the HTTP download route."
---

# Session export over ACP

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-acp` gains three dsh extension methods (ACP 1.4.0 defines no export surface), additive and method-discovery-free:

- `session/export_begin { sessionId, includeDescendants? }` opens a point-in-time snapshot of the session's log — live events flushed first — and answers `{ exportId, filename }` with the canonical `dsh-session-<sessionId>.zip`. `includeDescendants: true` traces the session lineage and adds each descendant log under `subagents/<id>/`. The archive bytes equal the HTTP `/api/session.export` download over identical inputs.
- `session/export_read { exportId }` pulls the next chunk: `{ data, eof }` with canonical base64 within the configured bound, `eof: true` only after the producer is drained. Read pace gates the producer, so a slow consumer cannot be overrun.
- `session/export_cancel { exportId }` releases the cursor immediately and answers `{}`.

Error vocabulary on `data.code`: `not_found` (the root log has no exportable content; answered before any byte), `export_failed` (a mid-stream producer failure; the message is a sanitized fixed string), and `unknown_cursor` (the cursor id is unknown or already terminal; rides `Invalid params`). An unknown session id fails `export_begin` with `Invalid params`. A composition without the session-query, session-persistence, or attachment services fails loud with an internal error naming the missing packages.

New Config fields on the plugin: `exportChunkBytes` (default 262144, validated over 16384–4194304 at load) and `exportCompressionLevel` (0–9, default 6). No new notification type, session event, `SessionEventMap` member, or SDK type is introduced: the trio is invisible to the session log, so `session/close` does not abort an in-flight export and concurrent snapshots of one session are independent.

## Migration

1. Adopting clients: call `export_begin`, loop `export_read` until `eof`, decode and concatenate the base64 chunks, and unzip the result. A disconnect or restart just begins a fresh export — the snapshot is point-in-time, not resumable across processes.
2. Clients that reject unknown methods keep working unchanged; the trio never proactively notifies. Rollback to an older build answers the three methods with `Method not found` (-32601).
3. `cordis.yml` needs no change; deployers may pin `exportChunkBytes` / `exportCompressionLevel` under the `acp` plugin's config to tune chunk size or archive size.
4. Confirm: in an ACP session, run one prompt, then `export_begin` and read to `eof` — the unzipped archive contains `session.v4.jsonl` carrying that prompt's events.

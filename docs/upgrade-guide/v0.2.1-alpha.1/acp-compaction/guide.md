---
kind: upgrade-guide
description: "ACP exposes explicit manual compaction: the session/compact extension method returning the engine's durable result, capability-negotiated compaction_update notifications, and the busy wire branch for active sessions."
---

# ACP session compaction

English | [中文](guide.zh.md)

## Change

ACP sessions previously had no compaction surface, so clients could not trigger or observe dsh context compaction. The next release adds an explicit face:

- `session/compact` (request `{ sessionId }`, response `{ result }`) runs the session's composed compaction engine once and returns its durable result — `compactionId`, `summarySeq`, `shadowedRange`, `shadowedCount`, `shadowedTokenCount`, and the `summary` blocks — or `{ result: null }` when no history is compactible. ACP 1.4.0 defines no compaction request, so the method is a dsh extension with an explicit params parser.
- Compaction progress rides a new `compaction_update` variant of `session/update`, negotiated by the `session.compaction` client capability declared at `initialize`: a declared connection receives the ordered pair — `in_progress`, then `completed` carrying the summary blocks, or `failed` carrying the error text — derived from the durable `compaction/*` events and enqueued before the response write, exactly like `current_mode_update`. An undeclared connection executes the identical engine call and receives zero compaction updates.
- Calling `session/compact` while the session has active work fails with an internal error carrying `data.code: "busy"`, mirroring in-process maintenance. An unknown session id fails with `Invalid params`; a composition without a compaction engine fails with an internal error naming the gap.
- The engine path is the same one automatic compaction uses: the durable `compaction/start` / `compaction/summary` / `compaction/end` events record the bridge-minted `acp-` initiator, and the summary reaches later turns only through the session log, so resumed sessions reconstruct through the compacted history unchanged.

## Migration

1. ACP clients that want to drive compaction: declare `clientCapabilities: { session: { compaction: {} } }` at `initialize`, call `session/compact` between turns, and wait for the matching `compaction_update` pair before relying on the result — the updates precede the response on the wire, and the `completed` update is the effect observation.
2. Clients that do not care can ignore the method entirely; omitting the capability keeps the connection silent on compaction while leaving execution available.
3. Treat `busy` (`data.code: "busy"`) as retryable after the session settles: cancel or await the active turn, then call again.
4. Confirm: a fresh session returns `{ result: null }` with no notifications; after two prose turns the call returns a non-null result whose `summary` carries at least one text block, and a resumed process serves turns through the compacted log.

---
kind: upgrade-guide
description: "ACP exposes the plan-mode face through the standard surface: modes advertisement on session/new and session/resume, session/set_mode with the plan/normal vocabulary, current_mode_update notifications, and plan reviews riding session/request_permission."
---

# ACP plan mode

English | [中文](guide.zh.md)

## Change

ACP sessions previously had no mode surface, so clients could not see or control dsh plan mode. The next release adds the standard face:

- `session/new` and `session/resume` responses carry an optional `modes` field — `currentModeId` plus `availableModes` with the `plan` / `normal` vocabulary and display names — exactly when the session composition mounts `@deepseek-ai/dsh-plan-mode` (the shipped `dsh-base` bundle mounts it). The field's presence is the advertisement; compositions without the plugin omit it entirely.
- `session/set_mode` (request `{ sessionId, modeId }`, response `{}`) validates the id against the advertised vocabulary and applies it. Unknown ids fail with `Invalid params` naming the vocabulary; a composition without the plugin fails with an internal error. The response does not promise the outcome: the `current_mode_update` notification derived from the durable `plan/mode` event is the only effect observation, and the agent enqueues it before the response write, so clients observe the new mode first.
- Commit timing follows the plan-mode controller: a between-turns selection commits immediately; a mid-turn selection queues until the next accepted in-turn pre-step commits it; re-selecting the committed state clears a pending opposite selection silently, with no notification.
- A plan review — the `exit_plan_mode` question carrying the plan-review intent — now rides `session/request_permission` with option ids `approve` (`allow_once`) and `keep-planning` (`reject_once`), instead of failing with the no-answerer `NO_PROVIDER` error. A client that cancels the permission request maps to the tool's dismissed-review branch, and the session keeps its mode. Other user questions (different intents, multi-question batches) keep the existing no-answerer behavior.

## Migration

1. ACP clients: read `modes` from `session/new` / `session/resume` when present and render the two entries; handle `current_mode_update` notifications as the authoritative mode state. Clients that do not care can ignore all of it — the field is optional and the notification arrives only after an explicit `session/set_mode` or an in-turn plan-mode switch.
2. Treat `session/set_mode` responses as acknowledgement, not confirmation: wait for the matching `current_mode_update` before relying on the new mode. The update precedes the response on the wire.
3. Clients that answer `session/request_permission` prompts should expect the `approve` / `keep-planning` option pair while a plan review is open and answer by option id as with any other permission request; cancelling produces the dismissed-review behavior, not an error.
4. Confirm: `session/new` reports `currentModeId: "normal"` by default; `session/set_mode` with an unknown id fails with `Invalid params` naming `plan, normal`; a resume restores the committed mode.

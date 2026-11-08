---
kind: upgrade-guide
description: "ACP goal completion and block now ask the client for authorization over session/request_permission when no direct-human witness exists, and the goal tool result gains an authorization marker."
---

# Goal completion authorization over ACP

English | [中文](guide.zh.md)

## Change

An `update_goal` call with action `complete` or `blocked` previously failed with `GOAL_TOOL_AUTHORITY_REQUIRED` whenever the turn held neither a direct human message nor an admitted goal round. Where a user-questions answerer is composed — including the shipped `acp` profile — the tool now converts that denial into one authorization question and lets the model retry after a grant:

- The ask rides `session/request_permission` with option id `approve` (kind `allow_once`, label `Authorize`) and option id `deny` (kind `reject_once`, label `Deny`). The card follows the `update_goal` tool call it reviews.
- Approving never transitions the goal over the wire. The host steers a witnessed user message into the open turn — the human's authorization is part of that turn — and the denied call's result reports `authorization: { status: 'granted', action }`; the model re-calls with the same goal id and revision and only that re-call completes or blocks. Denying or dismissing the card fails the call with the original rejection, annotated with any decline feedback.
- Direct-human turns and admitted goal rounds never ask, and a composition without an answerer fails exactly as before.

Published types and exports: `AskUserQuestionIntent` in `@deepseek-ai/dsh-user-questions` gains the `goal-review` member (`approve`, `goalId`, optional `callId`) — presentation-only, so UIs that ignore it keep answering the generic option list. `@deepseek-ai/dsh-acp` exports `answerGoalReview`, `goalReviewPermissionOptions`, `GOAL_APPROVE_OPTION_ID`, and `GOAL_DENY_OPTION_ID`. The authorization leaves no new session event type: the log records a plain user message plus the existing tool and completion events, so older builds replay these sessions without loss.

## Migration

1. Automated ACP clients that answer every `session/request_permission` with `allow_once`: that policy now silently authorizes goal completion and block. Filter on the `approve`/`deny` option ids, or auto-answer `reject_once` to keep the previous fail-closed behavior.
2. Interactive clients need no protocol work: render the two-option card generically or branch on the `Authorize`/`Deny` labels.
3. Host UIs consuming `AskUserQuestionIntent`: present `goal-review` as a goal authorization decision, or fall through to the generic option list — the answer encoding is identical either way.
4. `cordis.yml` needs no change; the ask activates only where `dsh-tool-goal` and a user-questions answerer are both composed.
5. Rollback: older builds never send the ask and fail the call with `GOAL_TOOL_AUTHORITY_REQUIRED`; sessions recorded under this release replay on them unchanged.
6. Confirm: in an ACP session, run `update_goal` with action `complete` outside a direct-human turn — exactly one `session/request_permission` with the `approve`/`deny` options arrives; answering `approve` completes the goal on the model's re-call, answering `deny` leaves the goal active.

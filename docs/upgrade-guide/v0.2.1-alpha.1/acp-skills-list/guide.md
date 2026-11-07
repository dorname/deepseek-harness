---
kind: upgrade-guide
description: "ACP adds the session/skills_list extension method: a read-only, invocation-neutral skill catalog per session with both resolved invocation flags."
---

# ACP session skill enumeration

English | [中文](guide.zh.md)

## Change

ACP sessions previously exposed no skill surface: ACP 1.4.0 defines none, so clients such as editors could not discover which skills a session offers. The next release adds one dsh extension method:

- `session/skills_list` (request `{ sessionId }`) returns `{ skills: [...] }`, name-sorted. Each entry carries exactly `name`, `description`, and the resolved `modelInvocable` / `userInvocable` flags from the skill registry. The catalog is invocation-neutral: nothing is filtered out, and both flags ride the wire so each client renders or gates entries by its own policy.
- The catalog resolves the session's preset-mounted scoped skill registry first, then the host composition's global registry. A composition that mounts neither fails with an internal error naming the gap; an unknown session id fails with `Invalid params`.
- The call is read-only: no session event is appended, repeated calls agree, and there is no change notification — clients re-pull to observe catalog changes. Skill bodies are never loaded over ACP; invocation still goes through the model's `skill` tool or user gestures.

Deployments whose composition includes the shipped `dsh-base` bundle already mount the skill registry, so the method returns the deployment's real catalog out of the box.

## Migration

1. ACP clients: call `session/skills_list` after `session/new` (or `session/resume`) to discover the catalog; render entries according to the flags, or generically ignore the method if not needed.
2. Do not assume an empty catalog means skills are unsupported: a mounted-but-empty catalog returns `[]`, while an unmounted registry fails with an internal error naming the missing service.
3. Confirm: the response entries are name-sorted with exactly the four agreed fields; an unknown session id returns `Invalid params`; repeating the call returns the same catalog.

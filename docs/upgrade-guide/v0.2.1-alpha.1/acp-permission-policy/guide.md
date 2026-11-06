---
kind: upgrade-guide
description: "ACP advertises per-session permission_policy and permission_preset options and adds the always approval tier that asks before every tool call."
---

# ACP session permission options and the always approval tier

English | [中文](guide.zh.md)

## Change

ACP sessions previously exposed no permission controls: the approval policy was fixed by the deployment's `approval` plugin config (`ask` | `never`). The next release advertises two session config options and adds a third policy tier:

- `permission_policy` — a select over `ask`, `never`, `always`. `ask` behaves as before. `never` auto-rejects every ask source without prompting. `always` submits every tool call for approval right before it executes; requests offer only the one-shot options (`allow_once`, `reject_once`), never a durable grant. The choice is per session, persists in the session log, and survives resume.
- `permission_preset` — applies a deployment-defined bundle (sandbox mode + approval policy) in one call; the shipped catalog is `read-only`, `workspace-write`, `danger-full-access`. When the knobs no longer match a bundle, the derived current value reads `custom`.

Unknown values for either option and mutations when the backing service is not composed fail with `Invalid params` instead of being ignored. Clients listing config options will see the two new ids.

Read compatibility: `always` switches persist as a new ordinary session event type, `approval/policy-always` (`ask`/`never` switches keep the existing `approval/policy` event). Builds older than this release do not know the new event type and refuse to open a session log that contains one, naming the unknown type — the required-on-read rule; sessions that only used `ask`/`never` remain fully readable. The `always` guarantee holds only on upgraded readers, so upgrade all readers of a shared session store before relying on `always`. The deployment `approval` config continues to accept only `ask` and `never`; `always` is a per-session, client-driven choice.

## Migration

1. ACP clients: render or generically ignore the new `permission_policy` and `permission_preset` ids in `session/new` and config-mutation responses.
2. To opt a session into `always`: send `session/set_config_option` with `configId: "permission_policy"`, `value: "always"`, then expect one `session/request_permission` per tool call; answer `allow_once` or `reject_once`.
3. Deployments sharing session stores across versions: upgrade every reader before using `always`; older builds treat the persisted value as `ask`.
4. To switch posture in one step: set `permission_preset` to a catalog value instead of the two knobs separately.
5. Confirm: `session/new` lists both ids; setting `permission_policy` to an unknown value returns `Invalid params` naming the accepted values; under `always` each tool call produces exactly one permission request.

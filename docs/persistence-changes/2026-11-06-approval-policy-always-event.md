---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-06-approval-policy-always-event

English | [中文](2026-11-06-approval-policy-always-event.zh.md)

## Summary

Adds the `approval/policy-always` ordinary session event type so the new `always` approval policy tier has a durable, replayable switch record. Ask and never switches keep the existing `approval/policy` event, whose payload stays frozen at the accepted format-4 vocabulary (`ask` | `never` plus the optional delegation `source`); widening that union would be a breaking same-level payload change. The new event is born versioned (`version: 0`, the established `subagent/catalog` pattern) so future payload growth lands as higher-version alternatives without a format bump. Readers fold the last policy event of either type by seq.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-06-approval-policy-always-event
baseline: false
changes:
  - root: "event:approval/policy-always"
    previous: null
    after: "185b1eaaf2c894cd6293c92773f43eeff133b1cd3f875393d5970948f0b9baa0"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Adding an ordinary event type is a same-version change. Builds older than this change do not know `approval/policy-always` and refuse to open a session log that contains one, naming the unknown type — the required-on-read rule; sessions that only used ask/never remain fully readable. The delegation seed path only ever writes `never`, so child sessions inherit under the unchanged event. No Session header, envelope, or surface structure changes; SESSION_FORMAT_VERSION stays 4.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/interaction/user-approval/tests packages/interaction/permission-presets/tests: 78 tests passed. pnpm exec vitest run packages/acp/acp/tests packages/core/tools/tests packages/subagent/subagent/tests packages/subagent/subagent-in-process-driver/tests: 948 passed, 1 pre-existing environment failure (a root-ignores-chmod cwd test unrelated to this change). pnpm run test:snapshot: 182 passed with 1 pre-existing Node load-hook environment failure; the permission-policy snapshot was re-recorded against the live API and refreshed. pnpm run typecheck and pnpm run lint passed. OpenLogos reporter ledgers regenerated: UT-S49-01..07, ST-S49-01/02, SMOKE-acp-network-01/02/03 all pass.

<a id="dev-note"></a>
## Dev Note

None.

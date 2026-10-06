---
description: "Per-user dsh process registry for User Fleet deployments: lazy provisioning into a dedicated home, idle recycling, bounded crash restarts, and a hard concurrency limit."
kind: "package-library"
---

# @deepseek-ai/dsh-fleet-manager

English

## Summary

The fleet manager is the process authority of a User Fleet deployment. For every authenticated user it keeps exactly one `dsh --profile web` process running with that user's dedicated `$DSH_HOME` (`<homesDir>/<subject>`), and for nobody else. It recycles processes idle beyond the configured threshold (keeping their data), restarts crashed processes within a bounded sliding window, and enforces the deployment's concurrency limit so a burst of logins can never oversubscribe the host. Every transition is emitted as a structured lifecycle event for operators. Deployment operators run it directly; the gateway is its only intended consumer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Run one fleet manager per host. Point `homesDir` at the directory that will hold every user's home, and tune the knobs the deployment needs:

| Field | Meaning | Default |
|---|---|---|
| `homesDir` | Root under which each user's `$DSH_HOME` is created | required |
| `dshCommand` | Command launched per user (`--port 0` appended) | `dsh --profile web` |
| `maxUsers` | Concurrent user-process limit; excess logins are rejected | 8 |
| `idleRecycleMs` | Idle duration before a process is recycled (data kept) | 30 min |
| `maxRestarts` / `restartWindowMs` | Crash restarts allowed inside a sliding window | 3 / 60 s |
| `stopTimeoutMs` | SIGTERM grace before recycle escalation | 10 s |
| `portReadyTimeoutMs` | Wait for the OS-assigned port before failing loud | 60 s |

```ts
import { FleetManager } from '@deepseek-ai/dsh-fleet-manager'

const fleet = new FleetManager({ homesDir: '/data/homes', maxUsers: 4 })
fleet.startRecycleLoop()
const outcome = await fleet.ensureProcess(subject) // ready { port, home } | rejected 'limit'
fleet.processInfo(subject) // { port, pid, home, launchUrl } | undefined, for observation
await fleet.dispose()
```

Invalid subjects (anything outside `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) throw: the subject becomes a home directory name, so filesystem safety is enforced at the entry point. A rejected login is an explicit `rejected(limit)` outcome backed by a `rejected` event — the manager never silently oversubscribes the host.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design notes

- **One registry, one owner.** The manager is the only component that spawns, stops, or restarts user processes; the gateway only observes.
- **Lazy provisioning.** Processes exist only for users who logged in; there is no pre-provisioning pass.
- **Recycling keeps data.** A recycle stops the process and leaves `<homesDir>/<subject>` untouched; the next login re-provisions from the same home, so sessions survive recycling by the session log's append-only generations.
- **Restart budget.** Crashes inside `restartWindowMs` accumulate across restarts per subject; exceeding `maxRestarts` moves the subject out of the registry with a `failed` event instead of crash-looping the host. A deliberate stop (recycle, shutdown) clears the budget for the subject's next login.
- **Spawner seam.** `FleetProcess` abstracts the child; the production spawner (`spawnDshWebProcess`) launches with `--port 0`, injects `DSH_HOME` and `DSH_FLEET_USER_ID`, and resolves on the printed loopback URL.

| File | Role |
|---|---|
| [`src/config.ts`](src/config.ts) | Config fields, defaults, and fail-loud validation; `FLEET_SUBJECT_PATTERN` |
| [`src/process.ts`](src/process.ts) | `FleetProcess` seam and the production `dsh --profile web` spawner |
| [`src/fleet-manager.ts`](src/fleet-manager.ts) | Registry, provisioning, recycling, restarts, limit, lifecycle events |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None. The fleet manager runs deployment-side processes and touches no model-visible surface; user sessions inside each process behave exactly as in a single-user deployment.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single host.** The registry is in-process; multi-host fleets (shared persistence, distributed scheduling) are later milestones of the multi-user plan.
- **Idle detection is touch-driven.** Activity is observed through `ensureProcess`/`touch`; a long-running turn with no gateway forwarding can still be recycled once its grace expires.
- **Local trust model.** The host's administrative user can reach every process and home; hardening the management plane is out of scope for this milestone.
- **Windows untested.** The POSIX process semantics (SIGTERM escalation, signal-based crash detection) are exercised on POSIX only; the test suites are excluded from the Windows lanes.

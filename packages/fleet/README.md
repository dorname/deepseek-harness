---
description: "The fleet package group: per-user process lifecycle and authenticated routing for self-hosted multi-user (User Fleet) deployments."
kind: "package-group"
---

# fleet/ — User Fleet deployment components

English

## Summary

The fleet group carries the two deployment-side components that turn one self-hosted machine into a multi-user deployment: the fleet manager owns one dsh web process (and one dedicated `$DSH_HOME`) per logged-in user, and the gateway authenticates users and routes each request to the owning user's process. The components are deployment processes, not Cordis plugins: dsh package semantics are unchanged, and a single-user `dsh web` deployment uses neither of them. Each package README owns its details; this page maps the group.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`fleet-manager`](fleet-manager/README.md) | Provisions, recycles, restarts, and bounds one dsh web process per user, each with its own `$DSH_HOME` |
| [`gateway`](gateway/README.md) | Authenticates users (OIDC), routes every request to the owning user's process, and rejects cross-user access |

<a id="related-documentation"></a>
## Related documentation

- [Public deployments guide](../../docs/user/guide/public-deployments.md) — the single-user reverse-proxy path the gateway builds on.
- [dsh-home-paths](../util/home-paths/README.md) — owns `$DSH_HOME` resolution, the per-user isolation directory.
- [dsh-anonymous-user-id](../identity/anonymous-user-id/README.md) — the audit attribution that carries the fleet-injected subject.

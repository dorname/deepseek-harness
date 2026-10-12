# dsh-cluster-web Helm chart (P2)

Projects the same topology as Compose / `dsh up`: Ingress same-origin → API Service → edge → shell + API-only on loopback (S46).

## One-click

```sh
helm upgrade --install dsh deploy/cluster-web/chart -n dsh-cluster-web --create-namespace
```

Defaults: `apiReplicas=1`, `runnerReplicas=0`. Do not raise above 2 for acceptance smokes.

## Pod layout

Each API pod runs three containers sharing the pod network:

1. **shell** — SPA + `/?token=` (`serveFrontend: true`) on `127.0.0.1:3079`
2. **dsh** — `--api-only` on `127.0.0.1:3080` (product bind rule)
3. **edge** — `0.0.0.0:EDGE_PORT`; `STATIC_UPSTREAM`→shell, `API_UPSTREAMS`→dsh

## See also

- [cluster-web README](../README.md)
- SMOKE-core-22 — values/template acceptance without requiring a live cluster
- SMOKE-core-23 — live supervise fe-split auth smoke

---
description: "Kubernetes topology for cluster-web: one frontend Deployment and scalable api Deployments sharing one DSH_HOME PVC."
kind: "reference"
---

# dsh-cluster-web Helm chart

English | [中文](README.zh.md)

## Summary

The chart projects the S47 topology into Kubernetes: Ingress sends all traffic to the frontend Service, while the api Service load-balances the API Deployment. API replicas are stateless pod processes; browser-session keys and durable session state live in the shared `DSH_HOME` PVC and optional Postgres.

## Install

Build the image from the repository root, then install the chart:

```sh
docker build \
  --build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
  -f deploy/cluster-web/Dockerfile -t dsh-cluster-web:local .
helm upgrade --install dsh deploy/cluster-web/chart -n dsh-cluster-web --create-namespace
```

For a remote cluster, push the image to its registry and set `image.repository` and `image.tag` with `--set`.

Scale the backend to two replicas:

```sh
helm upgrade --install dsh deploy/cluster-web/chart -n dsh-cluster-web --reuse-values --set apiReplicas=2
```

## Pod layout

| Deployment | Replicas | Containers | Network |
|------------|----------|------------|---------|
| `frontend` | 1 | `shell` on loopback, public `edge` | Ingress and frontend Service reach only `edge` |
| `api` | `apiReplicas` | API-only `dsh` on loopback, `forward` in-network | frontend reaches the api Service, which selects forwarder containers |

Both Deployments mount the same ReadWriteMany PVC. The API entry applies `overlays/api.overlay.yml` when Postgres is enabled, so session persistence and stream relay state are stored in Postgres rather than an API pod. The PVC owns the cross-replica browser-session key. `apiReplicas` defaults to 1; acceptance smoke keeps it at 2 or fewer.

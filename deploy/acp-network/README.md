# ACP-over-network Staging Deployment

English | [中文](README.zh.md)

This directory holds example Kubernetes manifests, a Dockerfile, and helper scripts for staging a standalone ACP-over-network server.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage image building `dsh --profile acp-network` |
| `.dockerignore` | Build-context exclusions mirroring `deploy/cluster-web` |
| `scripts/build-image.sh` | Build and optionally push the staging image |
| `scripts/deploy-staging.sh` | Apply manifests and wait for rollout |
| `scripts/smoke-staging.sh` | Run the protocol smoke against a deployed server |
| `k8s/deployment.yaml` | dsh Pod running `dsh --profile acp-network` |
| `k8s/service.yaml` | Cluster Service for the ACP port |
| `k8s/ingress.yaml` | Ingress exposing `/acp` with WebSocket upgrade support |
| `k8s/networkpolicy.yaml` | Restrict ingress to the dspm chat relay |
| `k8s/pvc.yaml` | PersistentVolumeClaim backing the Pod's durable `$DSH_HOME` |
| `k8s/secret.example.yaml` | Example secrets; copy, fill in, and apply as `secret.yaml` |

## Build the image

From the repository root:

```sh
./deploy/acp-network/scripts/build-image.sh
```

Environment overrides:

- `DSH_ACP_NETWORK_IMAGE` — image name (default `dsh-acp-network`)
- `DSH_ACP_NETWORK_TAG` — image tag (default `git rev-parse --short HEAD`)
- `DSH_ACP_NETWORK_PUSH_REGISTRY` — push the image to this registry after building

## Deploy

1. Copy and edit secrets:
   ```sh
   cp deploy/acp-network/k8s/secret.example.yaml deploy/acp-network/k8s/secret.yaml
   # edit secret values
   ```
2. Deploy to the current kubectl context/namespace:
   ```sh
   ./deploy/acp-network/scripts/deploy-staging.sh
   ```
   Optional overrides:
   - `DSH_ACP_NETWORK_NAMESPACE` — target namespace (default `default`)
   - `DSH_ACP_NETWORK_IMAGE` / `DSH_ACP_NETWORK_TAG` — image to deploy
   - `DSH_ACP_NETWORK_PUSH_REGISTRY` — pull image from a remote registry
   - `DSH_ACP_NETWORK_HOME_SIZE` — PVC capacity request (default `10Gi`)

   The script applies the manifests and then rolls the deployment so that any secret change is picked up by new Pods.

3. Verify the pod is ready:
   ```sh
   kubectl rollout status deployment/dsh-acp-network
   ```

## Run the local protocol smoke

The package smoke boots the server in-process without Kubernetes:

```sh
pnpm -F @deepseek-ai/dsh-acp-network smoke
```

This verifies the WebSocket transport, HMAC token authentication, full prompt loop with a mocked LLM, and resume-after-reconnect flow.

## Verify staging end-to-end

After deploying to staging, forward the service and run the smoke runner:

```sh
kubectl port-forward service/dsh-acp-network 13080:80 &
export ACP_SMOKE_URL=ws://127.0.0.1:13080/acp
export ACP_SMOKE_SECRET=<same-secret>
export ACP_SMOKE_SUBJECT=<same-subject>
export ACP_SMOKE_AUDIENCE=<same-audience>
./deploy/acp-network/scripts/smoke-staging.sh
```

When `DEEPSEEK_API_KEY` is not set, the runner automatically enables `ACP_SMOKE_NO_PROMPT=true` and verifies handshake, authentication, session lifecycle, and resume without calling the LLM. To run the full prompt smoke, either export a valid key or set `ACP_SMOKE_NO_PROMPT=false`.

## Persistence

The Pod's `$DSH_HOME` mounts the `dsh-acp-network-home` PVC, so session logs, attachments, and KV storage survive Pod replacement, and `session/resume` rebuilds from that state after a reconnect. Verify it with:

```sh
ACP_SMOKE_VERIFY_POD_RESTART=true ./deploy/acp-network/scripts/smoke-staging.sh
```

The script creates a session, rolls the Deployment, and resumes the same session id; it opens its own temporary port-forward, so `ACP_SMOKE_URL` is not needed and `kubectl` must be available (namespace: `DSH_ACP_NETWORK_NAMESPACE`).

Client contract: each model request is checkpointed before it starts, so a turn interrupted by Pod replacement leaves no partial output in the resumed history and the client resubmits the prompt. Resuming requires the session's original `cwd`.

Scaling beyond one replica needs session-affine routing first: active sessions are owned by one Pod process, and resume has no cross-Pod mutual exclusion. Postgres-backed persistence is the upgrade path once that work starts.

## Rollback

Scale to zero or delete the Deployment:

```sh
kubectl scale deployment dsh-acp-network --replicas=0
```

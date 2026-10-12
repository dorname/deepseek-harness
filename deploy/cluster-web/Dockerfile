# cluster-web image: built dsh CLI + deploy/cluster-web supervise tree.
# Build from repository root:
#   DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
#     docker compose -f deploy/cluster-web/docker-compose.yml build
# Context has no .git — pass DSH_CLIENT_COMMIT_HASH (7–40 hex) for client metadata.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

# Workspace roots + sources that `pnpm run build` / tsconfig.host.json typecheck.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY vendor ./vendor
COPY native ./native
COPY scripts ./scripts
COPY website ./website
COPY snapshots ./snapshots
COPY docs ./docs
COPY benchmarks ./benchmarks
COPY python ./python
COPY tsconfig.base.json tsconfig.base.client.json tsconfig.json tsconfig.host.json tsconfig.client.json ./
# Root tsdown workspace config — without it host tsdown falls back to package.json and fails with "No input files".
COPY tsdown.config.ts ./
COPY vitest.config.ts ./
# Host typecheck reaches apps/cli tests that import deploy/cluster-web/upstream.mts.
COPY deploy ./deploy

ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

RUN pnpm install --frozen-lockfile \
  && pnpm run build \
  && pnpm store prune

ENV DSH_CONFIG_READONLY=1
EXPOSE 8080
ENTRYPOINT ["node", "--import", "tsx/esm", "deploy/cluster-web/supervise.mts"]

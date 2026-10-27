# ACP-over-network staging image.
# Builds the dsh CLI and runs the acp-network profile.
#
# Build from repository root:
#   DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) \
#     docker build -f deploy/acp-network/Dockerfile -t dsh-acp-network:latest .

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

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
COPY tsdown.config.ts ./
COPY vitest.config.ts ./
COPY deploy ./deploy

ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

RUN pnpm install --frozen-lockfile \
  && pnpm run build \
  && pnpm store prune

ENV DSH_CONFIG_READONLY=1
EXPOSE 3080

CMD ["node", "apps/cli/lib/bin.js", "--profile", "acp-network"]

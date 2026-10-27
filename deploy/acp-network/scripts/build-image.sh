#!/usr/bin/env bash
set -euo pipefail

# Build the ACP-over-network staging image.
# Run from repository root.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IMAGE_NAME="${DSH_ACP_NETWORK_IMAGE:-dsh-acp-network}"
IMAGE_TAG="${DSH_ACP_NETWORK_TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD)}"
DSH_CLIENT_COMMIT_HASH="${DSH_CLIENT_COMMIT_HASH:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"

echo "Building ${IMAGE_NAME}:${IMAGE_TAG} (commit ${DSH_CLIENT_COMMIT_HASH})..."

docker build \
  -f "$REPO_ROOT/deploy/acp-network/Dockerfile" \
  -t "${IMAGE_NAME}:${IMAGE_TAG}" \
  -t "${IMAGE_NAME}:latest" \
  --build-arg "DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}" \
  "$REPO_ROOT"

echo "Built ${IMAGE_NAME}:${IMAGE_TAG}"

if [[ -n "${DSH_ACP_NETWORK_PUSH_REGISTRY:-}" ]]; then
  REMOTE_IMAGE="${DSH_ACP_NETWORK_PUSH_REGISTRY%/}/${IMAGE_NAME}:${IMAGE_TAG}"
  echo "Tagging and pushing ${REMOTE_IMAGE}..."
  docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "$REMOTE_IMAGE"
  docker push "$REMOTE_IMAGE"
  echo "Pushed ${REMOTE_IMAGE}"
fi

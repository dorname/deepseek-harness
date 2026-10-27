#!/usr/bin/env bash
set -euo pipefail

# Deploy ACP-over-network to a staging Kubernetes cluster.
# Run from repository root.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MANIFEST_DIR="$REPO_ROOT/deploy/acp-network/k8s"
NAMESPACE="${DSH_ACP_NETWORK_NAMESPACE:-default}"
IMAGE_NAME="${DSH_ACP_NETWORK_IMAGE:-dsh-acp-network}"
IMAGE_TAG="${DSH_ACP_NETWORK_TAG:-latest}"
HOME_SIZE="${DSH_ACP_NETWORK_HOME_SIZE:-10Gi}"
SECRET_FILE="$MANIFEST_DIR/secret.yaml"

if [[ ! -f "$SECRET_FILE" ]]; then
  echo "Secret file not found: $SECRET_FILE" >&2
  echo "Copy k8s/secret.example.yaml to k8s/secret.yaml, fill in the values, and re-run." >&2
  exit 1
fi

kubectl="${KUBECTL:-kubectl}"

# Substitute the target image directly into the deployment manifest so the
# rollout never creates an intermediate pull-failing replica.
DEPLOYMENT_TMP="$(mktemp)"
PVC_TMP="$(mktemp)"
trap 'rm -f "$DEPLOYMENT_TMP" "$PVC_TMP"' EXIT
sed "s|image: dsh-acp-network:latest|image: ${IMAGE_NAME}:${IMAGE_TAG}|g" \
  "$MANIFEST_DIR/deployment.yaml" > "$DEPLOYMENT_TMP"
sed "s|storage: 10Gi|storage: ${HOME_SIZE}|g" \
  "$MANIFEST_DIR/pvc.yaml" > "$PVC_TMP"

$kubectl apply -n "$NAMESPACE" -f "$PVC_TMP"
$kubectl apply -n "$NAMESPACE" -f "$SECRET_FILE"
$kubectl apply -n "$NAMESPACE" -f "$DEPLOYMENT_TMP"
$kubectl apply -n "$NAMESPACE" -f "$MANIFEST_DIR/service.yaml"
$kubectl apply -n "$NAMESPACE" -f "$MANIFEST_DIR/ingress.yaml"
$kubectl apply -n "$NAMESPACE" -f "$MANIFEST_DIR/networkpolicy.yaml"

# Restart so that updated secrets are reflected in the Pods.
$kubectl rollout restart -n "$NAMESPACE" deployment/dsh-acp-network

echo "Waiting for rollout..."
$kubectl rollout status -n "$NAMESPACE" deployment/dsh-acp-network --timeout=300s

echo "Deployed dsh-acp-network to namespace ${NAMESPACE}"

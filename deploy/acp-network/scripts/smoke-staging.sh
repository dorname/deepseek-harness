#!/usr/bin/env bash
set -euo pipefail

# Run the ACP-over-network smoke against an existing staging server.
#
# Required environment:
# - ACP_SMOKE_URL      — WebSocket URL, e.g. wss://dsh-acp-network.example/acp
# - ACP_SMOKE_SECRET   — shared HMAC secret
# - ACP_SMOKE_SUBJECT  — token subject (matches DSH_FLEET_USER_ID)
# - ACP_SMOKE_AUDIENCE — token audience (matches DSH_ACP_NETWORK_AUDIENCE)
#
# Optional:
# - ACP_SMOKE_STRICT=false — do not require stopReason === 'end_turn'
# - ACP_SMOKE_NO_PROMPT=true — skip prompt calls (useful when no LLM key is available)
# - ACP_SMOKE_VERIFY_POD_RESTART=true — verify durable sessions instead of the
#   standard suite: create a session, roll the Deployment, resume the same
#   session id, and prompt again. Requires kubectl; the script owns a
#   temporary port-forward, so ACP_SMOKE_URL is not needed in this mode.
#   Target namespace: DSH_ACP_NETWORK_NAMESPACE (default "default"); local
#   forward port: ACP_SMOKE_PORT_FORWARD_PORT (default 13081, off the manual
#   flow's 13080 to avoid colliding with a still-running tunnel).
#
# When DEEPSEEK_API_KEY is absent, the script automatically enables no-prompt mode.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

: "${ACP_SMOKE_SECRET:?must be set}"
: "${ACP_SMOKE_SUBJECT:?must be set}"
: "${ACP_SMOKE_AUDIENCE:?must be set}"

VERIFY_POD_RESTART="${ACP_SMOKE_VERIFY_POD_RESTART:-false}"
if [[ "$VERIFY_POD_RESTART" == "true" ]]; then
  KUBECTL="${KUBECTL:-kubectl}"
  NAMESPACE="${DSH_ACP_NETWORK_NAMESPACE:-default}"
  PORT_FORWARD_PORT="${ACP_SMOKE_PORT_FORWARD_PORT:-13081}"
  command -v "$KUBECTL" >/dev/null || { echo "ACP_SMOKE_VERIFY_POD_RESTART=true requires $KUBECTL" >&2; exit 1; }
else
  : "${ACP_SMOKE_URL:?must be set}"
fi

if [[ -z "${DEEPSEEK_API_KEY:-}" && "${ACP_SMOKE_NO_PROMPT:-}" != "false" ]]; then
  echo "DEEPSEEK_API_KEY not set; enabling ACP_SMOKE_NO_PROMPT=true"
  export ACP_SMOKE_NO_PROMPT=true
fi

cd "$REPO_ROOT"
SMOKE_RUN=(pnpm exec tsx packages/acp/acp-network/tests/smoke/protocol-smoke.ts)

PORT_FORWARD_PID=
SESSION_FILE=
cleanup() {
  if [[ -n "$PORT_FORWARD_PID" ]]; then
    kill "$PORT_FORWARD_PID" 2>/dev/null || true
    wait "$PORT_FORWARD_PID" 2>/dev/null || true
  fi
  if [[ -n "$SESSION_FILE" ]]; then
    rm -f "$SESSION_FILE"
  fi
}
trap cleanup EXIT

# Forward the Service to 127.0.0.1, replacing any tunnel this script opened
# earlier: the previous tunnel does not survive the Pod it targeted.
start_port_forward() {
  if [[ -n "$PORT_FORWARD_PID" ]]; then
    kill "$PORT_FORWARD_PID" 2>/dev/null || true
    wait "$PORT_FORWARD_PID" 2>/dev/null || true
    PORT_FORWARD_PID=
  fi
  "$KUBECTL" -n "$NAMESPACE" port-forward service/dsh-acp-network "${PORT_FORWARD_PORT}:80" >/dev/null 2>&1 &
  PORT_FORWARD_PID=$!
  for _ in $(seq 1 30); do
    if (exec 3<>"/dev/tcp/127.0.0.1/${PORT_FORWARD_PORT}") 2>/dev/null; then
      exec 3>&- 3<&- || true
      return 0
    fi
    sleep 1
  done
  echo "port-forward did not open 127.0.0.1:${PORT_FORWARD_PORT}" >&2
  return 1
}

if [[ "$VERIFY_POD_RESTART" == "true" ]]; then
  SESSION_FILE="$(mktemp)"

  start_port_forward
  echo "Phase 1: creating the durable session..."
  ACP_SMOKE_PHASE=persist ACP_SMOKE_SESSION_FILE="$SESSION_FILE" \
    ACP_SMOKE_URL="ws://127.0.0.1:${PORT_FORWARD_PORT}/acp" \
    "${SMOKE_RUN[@]}"

  echo "Rolling the Deployment..."
  "$KUBECTL" -n "$NAMESPACE" rollout restart deployment/dsh-acp-network
  "$KUBECTL" -n "$NAMESPACE" rollout status deployment/dsh-acp-network --timeout=300s

  start_port_forward
  echo "Phase 2: resuming the session after Pod replacement..."
  ACP_SMOKE_PHASE=resume ACP_SMOKE_SESSION_FILE="$SESSION_FILE" \
    ACP_SMOKE_URL="ws://127.0.0.1:${PORT_FORWARD_PORT}/acp" \
    "${SMOKE_RUN[@]}"

  echo "Pod-restart persistence verified."
  exit 0
fi

echo "Running ACP-over-network smoke against ${ACP_SMOKE_URL}..."
"${SMOKE_RUN[@]}"

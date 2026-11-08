/**
 * ACP-over-network smoke (`SMOKE-acp-network-01/02/03/04/05`, changes
 * `20261020-1643-acp-over-network`, `dsh-acp-permission-policy`,
 * `dsh-acp-skills-list`, `dsh-acp-plan-mode`, `dsh-acp-multi-provider`,
 * `dsh-acp-goal-approval`, and `dsh-acp-session-export`).
 *
 * - SMOKE-acp-network-01: WebSocket auth + session/new + prompt end-to-end
 *   (local mock LLM via `packages/acp/acp-network/tests/smoke/protocol-smoke.ts`).
 * - SMOKE-acp-network-02: session/close + reconnect + session/resume.
 * - SMOKE-acp-network-03: `always` permission round-trip over the network
 *   transport (two asks, allow-once executes, reject-once denies, unknown
 *   policy values fail loud). Staging targets skip it — the round-trip needs
 *   the local approval/preset/tool composition — and never report PASS for it.
 * - SMOKE-acp-network-04: `session/skills_list` enumeration over the network
 *   transport (seeded project fixture, four-field structure, name sort,
 *   frontmatter-resolved flags, unknown-session error, prompt round-trip +
 *   re-list). Staging targets skip it — the fixture needs the local skill
 *   composition — and never report PASS for it.
 * - SMOKE-acp-network-05: the plan-mode face over the network transport
 *   (`modes` advertisement on new/resume, `set_mode` commit + exactly-one
 *   `current_mode_update`, silent noop, vocabulary error branch, prompt
 *   round-trip). Rides standard methods, so it also verifies a staging
 *   target's deployed face.
 * - SMOKE-acp-network-06: the `session/compact` face over the network
 *   transport (structured result + ordered `compaction_update` pair on a
 *   capability-declaring connection, mid-turn busy branch, fresh-history
 *   `{ result: null }`, unknown-session error, undeclared-connection silence,
 *   resume through the compacted log). Staging targets skip it — the scripted
 *   compaction needs the local composition — and never report PASS for it.
 * - SMOKE-acp-network-07: the multi-provider supply face (change
 *   `dsh-acp-multi-provider`). A local server composition mounts real
 *   llm-pi-ai with two `providerList` routes over local mock HTTP backends:
 *   grouped configOptions advertisement, the default pair, the
 *   `set_config_option` switch landing on the chosen route, resume
 *   persistence, and the load-time failure of a both-keys composition.
 *   Staging targets skip it — the default staging composition has no
 *   providerList supply — and never report PASS for it.
 * - SMOKE-acp-network-08: the goal authorization round-trip (change
 *   `dsh-acp-goal-approval`). A local server composition drives an
 *   unauthorized goal completion over the real bridge: the request_permission
 *   card carries the approve/deny vocabulary, a Deny outcome leaves the goal
 *   active, and an Authorize outcome steers the witnessed user message whose
 *   re-call completes server-side. Staging targets skip it — the interactive
 *   authorization handshake needs the local composition — and never report
 *   PASS for it.
 * - SMOKE-acp-network-09: the session export trio (change
 *   `dsh-acp-session-export`). A scripted turn drives log events, then
 *   `session/export_begin` opens a pull cursor whose reads assemble the same
 *   ZIP artifact as the HTTP download route; the drained and cancelled
 *   cursors answer `unknown_cursor` for read and cancel alike. Staging
 *   targets skip it — the extension trio needs the local composition — and
 *   never report PASS for it.
 *
 * When namespace `dsh-acp-network-staging` is Ready and
 * `/tmp/dsh-acp-network-staging-creds.env` exists, also runs the staging
 * handshake/resume path (`ACP_SMOKE_NO_PROMPT`) as an extra check; ledger
 * status still follows the local protocol smoke (full prompt coverage).
 *
 * Appends JSONL records to `OPENLOGOS_SMOKE_RESULT_PATH`.
 *
 * @module
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')
const CREDS_FILE = '/tmp/dsh-acp-network-staging-creds.env'
const STAGING_NS = process.env.DSH_ACP_NETWORK_NAMESPACE ?? 'dsh-acp-network-staging'

function report(id: string, outcome: {
  durationMs: number
  scenario: string
  status?: 'pass' | 'fail' | 'skip'
  error?: string
}): void {
  const record: Record<string, unknown> = {
    id,
    status: outcome.status ?? 'pass',
    timestamp: new Date().toISOString(),
    duration_ms: outcome.durationMs,
    scenario: outcome.scenario,
  }
  if (outcome.error !== undefined) record.error = outcome.error
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`)
  console.log(`smoke-acp-network: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

function loadCreds(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

function stagingReady(): boolean {
  const result = spawnSync('kubectl', ['-n', STAGING_NS, 'get', 'deploy', 'dsh-acp-network', '-o', 'jsonpath={.status.availableReplicas}'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) return false
  const available = Number(result.stdout.trim() || '0')
  return available >= 1
}

function runLocalProtocolSmoke(): { ok: boolean; durationMs: number; error?: string } {
  const started = Date.now()
  const result = spawnSync('pnpm', ['exec', 'tsx', 'packages/acp/acp-network/tests/smoke/protocol-smoke.ts'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // The ledger's local lane must always run the full local suite including
    // the SMOKE-03 round-trip, so an ambient staging target in the caller's
    // environment must not silently downgrade it to a skip.
    env: {
      ...process.env,
      ACP_SMOKE_URL: '',
      ACP_SMOKE_NO_PROMPT: '',
      ACP_SMOKE_PHASE: '',
    },
  })
  const durationMs = Date.now() - started
  if (result.status !== 0) {
    return {
      ok: false,
      durationMs,
      error: `local protocol smoke exited ${String(result.status ?? result.signal)}`,
    }
  }
  return { ok: true, durationMs }
}

function runStagingHandshakeSmoke(): { ok: boolean; durationMs: number; error?: string; skipped?: boolean } {
  if (!existsSync(CREDS_FILE) || !stagingReady()) {
    return { ok: true, durationMs: 0, skipped: true }
  }
  const creds = loadCreds(CREDS_FILE)
  const started = Date.now()
  const script = [
    'set -euo pipefail',
    'pkill -f "port-forward service/dsh-acp-network 13080" >/dev/null 2>&1 || true',
    `kubectl -n "${STAGING_NS}" port-forward service/dsh-acp-network 13080:80 >/tmp/acp-smoke-pf.log 2>&1 &`,
    'PF_PID=$!',
    'cleanup() { kill "$PF_PID" >/dev/null 2>&1 || true; }',
    'trap cleanup EXIT',
    'for i in $(seq 1 30); do',
    '  if (exec 3<>/dev/tcp/127.0.0.1/13080) 2>/dev/null; then exec 3>&- 3<&-; break; fi',
    '  sleep 1',
    'done',
    './deploy/acp-network/scripts/smoke-staging.sh',
  ].join('\n')
  const result = spawnSync('bash', ['-lc', script], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ACP_SMOKE_URL: 'ws://127.0.0.1:13080/acp',
      ACP_SMOKE_NO_PROMPT: 'true',
      ACP_SMOKE_SECRET: creds.ACP_SMOKE_SECRET ?? '',
      ACP_SMOKE_SUBJECT: creds.ACP_SMOKE_SUBJECT ?? '',
      ACP_SMOKE_AUDIENCE: creds.ACP_SMOKE_AUDIENCE ?? 'dsh-acp',
      DSH_ACP_NETWORK_NAMESPACE: STAGING_NS,
    },
  })
  const durationMs = Date.now() - started
  if (result.status !== 0) {
    return {
      ok: false,
      durationMs,
      error: `staging handshake smoke exited ${String(result.status ?? result.signal)}`,
    }
  }
  return { ok: true, durationMs }
}

function main(): void {
  const local = runLocalProtocolSmoke()
  if (!local.ok) {
    const failedLanes = [
      { id: 'SMOKE-acp-network-01', scenario: 'local protocol prompt' },
      { id: 'SMOKE-acp-network-02', scenario: 'local protocol resume' },
      { id: 'SMOKE-acp-network-03', scenario: 'local permission round-trip' },
      { id: 'SMOKE-acp-network-04', scenario: 'local skills list enumeration' },
      { id: 'SMOKE-acp-network-05', scenario: 'local plan mode surface' },
      { id: 'SMOKE-acp-network-06', scenario: 'local compaction face' },
      { id: 'SMOKE-acp-network-07', scenario: 'local multi-provider supply face' },
      { id: 'SMOKE-acp-network-08', scenario: 'local goal authorization round-trip' },
      { id: 'SMOKE-acp-network-09', scenario: 'local session export trio' },
    ] as const
    for (const lane of failedLanes) {
      const outcome: Parameters<typeof report>[1] = {
        durationMs: local.durationMs,
        scenario: lane.scenario,
        status: 'fail',
      }
      if (local.error !== undefined) outcome.error = local.error
      report(lane.id, outcome)
    }
    process.exit(1)
  }

  report('SMOKE-acp-network-01', {
    durationMs: local.durationMs,
    scenario: 'local protocol prompt',
  })
  report('SMOKE-acp-network-02', {
    durationMs: local.durationMs,
    scenario: 'local protocol resume',
  })
  report('SMOKE-acp-network-03', {
    durationMs: local.durationMs,
    scenario: 'local permission round-trip',
  })
  report('SMOKE-acp-network-04', {
    durationMs: local.durationMs,
    scenario: 'local skills list enumeration',
  })
  report('SMOKE-acp-network-05', {
    durationMs: local.durationMs,
    scenario: 'local plan mode surface',
  })
  report('SMOKE-acp-network-06', {
    durationMs: local.durationMs,
    scenario: 'local compaction face',
  })
  report('SMOKE-acp-network-07', {
    durationMs: local.durationMs,
    scenario: 'local multi-provider supply face',
  })
  report('SMOKE-acp-network-08', {
    durationMs: local.durationMs,
    scenario: 'local goal authorization round-trip',
  })
  report('SMOKE-acp-network-09', {
    durationMs: local.durationMs,
    scenario: 'local session export trio',
  })

  // Staging handshake is advisory here: ledger coverage for 01/02 already
  // comes from the local protocol smoke (full prompt + resume). A Ready
  // Deployment may still be mid-rollout or lose the port-forward race.
  const staging = runStagingHandshakeSmoke()
  if (staging.skipped) {
    console.log('smoke-acp-network: staging handshake skipped (no Ready deploy/creds)')
  } else if (!staging.ok) {
    console.warn(`smoke-acp-network: staging handshake advisory fail: ${staging.error ?? 'unknown'}`)
  } else {
    console.log(`smoke-acp-network: staging handshake pass (${String(staging.durationMs)}ms)`)
  }
}

main()

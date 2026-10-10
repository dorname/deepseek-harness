/**
 * Execution-pool smoke runner (`SMOKE-core-14/15`, change
 * `agent-runner-pool`). Executes the two staging cases serially against a
 * real embedded Postgres (the staging shared medium) with two runner/replica
 * node instances:
 *
 * - SMOKE-core-14: runner A holds the session lease and stops renewing (its
 *   process is gone); runner B's orchestration loop takes over inside the
 *   lease window and drives the queued session's unconsumed work.
 * - SMOKE-core-15: one runner publishes session events and assistant-stream
 *   frames; two replica subscribers replay from a cursor and receive the
 *   identical record stream with no gaps and no duplicates.
 *
 * The whole-host CPU utilization is sampled throughout and must stay under
 * the deployment-configured threshold. Every case appends one JSONL record
 * to `OPENLOGOS_SMOKE_RESULT_PATH`.
 *
 * @module
 */

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { startEmbeddedCluster } from '../packages/storage/storage-postgres/tests/helpers/embedded.ts'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Result ledger path; `openlogos smoke` and this runner agree through the env override. */
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')

type CaseStatus = 'pass' | 'fail' | 'skip'

interface CaseOutcome {
  durationMs: number
  scenario: string
  status?: CaseStatus
  error?: string
}

/** Append one ledger record; the smoke dispatcher owns truncation at start. */
function report(id: string, outcome: CaseOutcome): void {
  appendFileSync('/tmp/m3-report-probe.log', `${id} → ${RESULT_PATH} cwd=${process.cwd()}\n`)
  const record: Record<string, unknown> = {
    id,
    status: outcome.status ?? 'pass',
    timestamp: new Date().toISOString(),
    duration_ms: outcome.durationMs,
    scenario: outcome.scenario,
  }
  if (outcome.error !== undefined) record.error = outcome.error
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`)
  console.log(`smoke-agent-runner-pool: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

class CaseFailure extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CaseFailure(message)
}

/** Run one smoke case body, reporting pass/fail with its measured duration. */
async function runCase(id: string, scenario: string, body: () => Promise<void>): Promise<void> {
  const started = Date.now()
  try {
    await body()
    report(id, { durationMs: Date.now() - started, scenario })
  } catch (error: unknown) {
    report(id, {
      durationMs: Date.now() - started,
      scenario,
      status: 'fail',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const { PostgresSessionLease } = await import('../packages/core/session-lease-postgres/src/index.ts')
  const { PostgresStreamRelay } = await import('../packages/core/stream-relay-postgres/src/index.ts')
  const { PostgresAgentDispatch } = await import('../packages/core/agent-dispatch/src/index.ts')

  const logs: string[] = []
  const cluster = await startEmbeddedCluster('dsh_smoke_pool', logs)
  if (cluster === undefined) {
    const reason = `embedded-postgres binaries unavailable (${logs.slice(-2).join(' | ') || 'import failed'})`
    for (const id of ['SMOKE-core-14', 'SMOKE-core-15']) {
      report(id, { durationMs: 0, scenario: 'execution pool smoke', status: 'skip', error: reason })
    }
    console.warn(`smoke-agent-runner-pool: SKIPPED: ${reason}`)
    return
  }
  for (const db of ['smoke_leases', 'smoke_relay', 'smoke_dispatch']) {
    await cluster.createDatabase(db)
  }
  const leasesUrl = cluster.url('smoke_leases')
  const relayUrl = cluster.url('smoke_relay')
  const dispatchUrl = cluster.url('smoke_dispatch')

  const mount = async (nodeId: string) => {
    const ctx = new Context()
    await ctx.plugin(PostgresSessionLease, { connectionString: leasesUrl })
    await ctx.plugin(PostgresStreamRelay, { connectionString: relayUrl })
    const dispatch = new PostgresAgentDispatch(ctx, { connectionString: dispatchUrl, nodeId, pollMs: 40, leaseTtlMs: 600, idleGraceMs: 0 })
    return { ctx, dispatch }
  }

  const monitor = startCpuMonitor(500)
  const SESSION = 'smoke-pool-session' as unknown as SessionId
  let failed = false

  try {
    await runCase('SMOKE-core-14', 'killed runner is taken over inside the lease window', async () => {
      const stopA = new AbortController()
      const stopB = new AbortController()
      const a = await mount('runner-a')
      const b = await mount('runner-b')
      const bDrives: SessionId[] = []
      try {
        // Runner A holds the lease but never renews after acquire (its loop
        // is killed before it would heartbeat), while B's loop waits behind
        // the held lease.
        await a.ctx.sessionLease.acquire(SESSION, 'runner-a', 600)
        Object.defineProperty(b.dispatch, 'drive', {
          value: async (session: SessionId): Promise<void> => {
            bDrives.push(session)
            await Promise.resolve()
          },
        })
        await b.dispatch.publish(SESSION)
        void b.dispatch.runLoop(stopB.signal)
        const deadline = Date.now() + 6000
        while (bDrives.length === 0 && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 30))
        }
        assert(bDrives.length > 0, 'runner B never took over the queued session after runner A stopped renewing')
      } finally {
        stopA.abort()
        stopB.abort()
      }
    })
  } catch {
    failed = true
  }

  if (!failed) {
    try {
      await runCase('SMOKE-core-15', 'two replicas converge on one publisher\'s stream', async () => {
        const publisher = await mount('runner-pub')
        const replica1 = await mount('replica-1')
        const replica2 = await mount('replica-2')
        const frames: Array<{ seq: number; kind: string; payload: unknown }> = []
        const collect = (relay: typeof replica1.ctx.streamRelay, target: number): Promise<typeof frames> => {
          return new Promise((resolve) => {
            const got: typeof frames = []
            let stop: (() => void) | undefined
            void relay.subscribe(SESSION, 0, (record) => {
              got.push({ seq: record.seq, kind: record.kind, payload: record.payload })
              if (got.length >= target) {
                stop?.()
                resolve(got)
              }
            }, 40).then((unlisten) => {
              stop = unlisten
            })
            setTimeout(() => { resolve(got) }, 6000)
          })
        }
        const collector1 = collect(replica1.ctx.streamRelay, 4)
        const collector2 = collect(replica2.ctx.streamRelay, 4)
        for (let i = 0; i < 4; i++) {
          await publisher.ctx.streamRelay.publish(SESSION, i % 2 === 0 ? 'session-event' : 'stream-frame', { i })
        }
        const [first, second] = await Promise.all([collector1, collector2])
        assert(JSON.stringify(first) === JSON.stringify(second), 'replicas observed different record streams')
        assert(first.map(record => record.seq).join(',') === '1,2,3,4', `replicas saw seqs ${first.map(record => record.seq).join(',')}, expected 1,2,3,4`)
        // Cursor replay: a late replica joining from seq 2 sees exactly 3..4.
        const replay = await new Promise<typeof frames>((resolve) => {
          const got: typeof frames = []
          let stop: (() => void) | undefined
          void replica2.ctx.streamRelay.subscribe(SESSION, 2, (record) => {
            got.push({ seq: record.seq, kind: record.kind, payload: record.payload })
            if (got.length >= 2) {
              stop?.()
              resolve(got)
            }
          }, 40).then((unlisten) => {
            stop = unlisten
          })
          setTimeout(() => { resolve(got) }, 4000)
        })
        assert(replay.map(record => record.seq).join(',') === '3,4', `cursor replay saw ${replay.map(record => record.seq).join(',')}, expected 3,4`)
      })
    } catch {
      failed = true
    }
  }

  const peak = monitor.peakPercent()
  monitor.stop()
  console.log(`smoke-agent-runner-pool: CPU peak ${peak.toFixed(1)}% <= threshold ${String(config.cpuThresholdPercent)}%`)
  assert(peak <= config.cpuThresholdPercent, `CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
  process.exit(failed ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(`smoke-agent-runner-pool: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})

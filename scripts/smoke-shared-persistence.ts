/**
 * Shared-persistence smoke runner (`SMOKE-core-12/13`, change
 * `shared-persistence-backends`). Executes the two staging cases serially
 * against a real embedded Postgres (the staging shared medium) with two
 * backend instances standing in for the two dsh Host nodes:
 *
 * - SMOKE-core-12: node A creates and commits a session, node B opens the
 *   same user's same session and reads identical events and header.
 * - SMOKE-core-13: two nodes injected with different fleet subjects write and
 *   read the same domain key in both directions and only ever observe their
 *   own namespace's value.
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
import { meta, oneTurnLog } from '../packages/session/session-persistence/tests/contract.ts'
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
  const record: Record<string, unknown> = {
    id,
    status: outcome.status ?? 'pass',
    timestamp: new Date().toISOString(),
    duration_ms: outcome.durationMs,
    scenario: outcome.scenario,
  }
  if (outcome.error !== undefined) record.error = outcome.error
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`)
  console.log(`smoke-shared-persistence: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
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
  const { default: PostgresSessionPersistence } = await import('../packages/session/session-persistence-postgres/src/index.ts')

  const logs: string[] = []
  const cluster = await startEmbeddedCluster('dsh_smoke_shared', logs)
  if (cluster === undefined) {
    const reason = `embedded-postgres binaries unavailable (${logs.slice(-2).join(' | ') || 'import failed'})`
    for (const id of ['SMOKE-core-12', 'SMOKE-core-13']) {
      report(id, { durationMs: 0, scenario: 'shared persistence smoke', status: 'skip', error: reason })
    }
    console.warn(`smoke-shared-persistence: SKIPPED: ${reason}`)
    return
  }
  await cluster.createDatabase('smoke_sessions')
  await cluster.createDatabase('smoke_domain')
  const sessionsUrl = cluster.url('smoke_sessions')
  const domainUrl = cluster.url('smoke_domain')

  const monitor = startCpuMonitor(500)
  let failed = false
  try {
    await runCase('SMOKE-core-12', 'two nodes converge on one committed session', async () => {
      const node = async (): Promise<{ ctx: Context; dispose: () => Promise<void> }> => {
        const ctx = new Context()
        const fiber = await ctx.plugin(PostgresSessionPersistence, { connectionString: sessionsUrl })
        return { ctx, dispose: async () => { await fiber.dispose() } }
      }
      const a = await node()
      const b = await node()
      try {
        const header = meta('smoke-shared-session')
        const writer = await a.ctx.sessionPersistence.create(header)
        await writer.append(oneTurnLog())
        await writer.flush()
        await writer.close()

        const snapshot = await b.ctx.sessionPersistence.stat(header.id)
        assert(snapshot !== undefined, 'node B never saw the committed session')
        assert(snapshot.header.id === header.id, 'node B saw a different session id')
        const reader = await b.ctx.sessionPersistence.open(header.id, 'read')
        const events = await reader.read()
        await reader.close()
        const seqs = events.events.map(event => event.seq)
        const wrote = oneTurnLog().map(event => event.seq)
        assert(JSON.stringify(seqs) === JSON.stringify(wrote),
          `node B read ${JSON.stringify(seqs)}, node A wrote ${JSON.stringify(wrote)}`)
      } finally {
        await a.dispose()
        await b.dispose()
      }
    })
  } catch {
    failed = true
  }

  if (!failed) {
    try {
      await runCase('SMOKE-core-13', 'per-user namespaces stay mutually invisible', async () => {
        const { default: Storage } = await import('../packages/storage/storage/src/index.ts')
        const { DomainFacility } = await import('../packages/storage/storage-domain/src/index.ts')
        const { Config, PostgresStorageBackend } = await import('../packages/storage/storage-postgres/src/index.ts')
        type Facility = InstanceType<typeof DomainFacility>
        const node = async (subject: string): Promise<{ facility: Facility; dispose: () => Promise<void> }> => {
          const ctx = new Context()
          const fiber = await ctx.plugin(Storage)
          const backend = new PostgresStorageBackend(new Config({ connectionString: domainUrl }))
          const unregister = ctx.storage.backend.register('postgres', backend)
          const facility = new DomainFacility(ctx, { backend: 'postgres', routes: {} }, { DSH_FLEET_USER_ID: subject })
          return {
            facility,
            dispose: async () => {
              unregister()
              await backend.close()
              await fiber.dispose()
            },
          }
        }
        const { defineDomain, domainTable } = await import('../packages/storage/storage-domain/src/index.ts')
        const { z } = await import('zod')
        const probeSchema = z.object({ value: z.string() })
        const spec = defineDomain({
          name: 'smoke',
          version: 1,
          tables: { probe: domainTable(probeSchema) },
        })
        const alice = await node('acc-alice')
        const bob = await node('acc-bob')
        try {
          const aliceDomain = await alice.facility.open(spec)
          await aliceDomain.table('probe').put('shared-key', { value: 'from-alice' })
          const bobDomain = await bob.facility.open(spec)
          const seenByBob = bobDomain.table('probe').get('shared-key')
          assert(seenByBob === undefined, `node B observed node A's value (${JSON.stringify(seenByBob)})`)
          await bobDomain.table('probe').put('shared-key', { value: 'from-bob' })
          const seenByAlice = aliceDomain.table('probe').get('shared-key')
          assert(String((seenByAlice as { value?: string } | undefined)?.value) === 'from-alice', 'node A observed a foreign or lost value')
          await aliceDomain.close()
          await bobDomain.close()
        } finally {
          await alice.dispose()
          await bob.dispose()
        }
      })
    } catch {
      failed = true
    }
  }

  const peak = monitor.peakPercent()
  monitor.stop()
  console.log(`smoke-shared-persistence: CPU peak ${peak.toFixed(1)}% <= threshold ${String(config.cpuThresholdPercent)}%`)
  assert(peak <= config.cpuThresholdPercent, `CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
  process.exit(failed ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(`smoke-shared-persistence: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})

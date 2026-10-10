/**
 * Host-local-services smoke runner (`SMOKE-core-16/17/18`, change
 * `distributed-host-services`). Executes the three staging cases serially
 * against a real embedded Postgres (the staging shared medium):
 *
 * - SMOKE-core-16: two schedule-dispatch loops race one due row — exactly
 *   one delivery, the row consumed.
 * - SMOKE-core-17: one webhook event through the ingress consumer creates
 *   exactly one Workspace Session (stubbed creation).
 * - SMOKE-core-18: runner A drains mid-drive — drain returns at the turn
 *   boundary, the lease releases, and runner B's loop takes the requeued
 *   session.
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
import type { SessionLease, LeaseFacts } from '../packages/core/session-lease/src/index.ts'
import { startEmbeddedCluster } from '../packages/storage/storage-postgres/tests/helpers/embedded.ts'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')

type CaseStatus = 'pass' | 'fail' | 'skip'

interface CaseOutcome {
  durationMs: number
  scenario: string
  status?: CaseStatus
  error?: string
}

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
  console.log(`smoke-host-services: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

class CaseFailure extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CaseFailure(message)
}

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

class FakeLease {
  private held = new Map<string, LeaseFacts>()
  async acquire(id: string, owner: string, ttlMs: number) {
    await Promise.resolve()
    const now = Date.now()
    const current = this.held.get(id)
    if (current !== undefined && current.owner !== owner && current.expiresAt >= now) {
      return { status: 'held' as const, holder: current }
    }
    this.held.set(id, { owner, expiresAt: now + ttlMs })
    return { status: 'acquired' as const }
  }
  async renew(id: string, owner: string, ttlMs: number) {
    await Promise.resolve()
    const current = this.held.get(id)
    if (current?.owner !== owner) return false
    this.held.set(id, { owner, expiresAt: Date.now() + ttlMs })
    return true
  }
  async release(id: string, owner: string) {
    await Promise.resolve()
    const current = this.held.get(id)
    if (current?.owner !== owner) return false
    this.held.delete(id)
    return true
  }
  async ownerOf(id: string) {
    await Promise.resolve()
    return this.held.get(id)
  }
  async waitLost(id: string, owner: string, pollMs = 20) {
    for (;;) {
      const current = this.held.get(id)
      if (current === undefined) return 'released'
      if (current.owner !== owner) return current.owner
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }
}

async function until(predicate: () => boolean, deadlineMs = 8000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  return predicate()
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const { PostgresScheduleDispatch } = await import('../packages/schedule/schedule-dispatch/src/index.ts')
  const { WebhookIngress } = await import('../packages/webhook/webhook-ingress/src/index.ts')
  const { PostgresAgentDispatch } = await import('../packages/core/agent-dispatch/src/index.ts')

  const logs: string[] = []
  const cluster = await startEmbeddedCluster('dsh_smoke_dhs', logs)
  if (cluster === undefined) {
    const reason = `embedded-postgres binaries unavailable (${logs.slice(-2).join(' | ') || 'import failed'})`
    for (const id of ['SMOKE-core-16', 'SMOKE-core-17', 'SMOKE-core-18']) {
      report(id, { durationMs: 0, scenario: 'host-local-services smoke', status: 'skip', error: reason })
    }
    console.warn(`smoke-host-services: SKIPPED: ${reason}`)
    return
  }
  for (const db of ['smoke_schedule', 'smoke_webhook', 'smoke_dispatch']) {
    await cluster.createDatabase(db)
  }

  const monitor = startCpuMonitor(500)
  let failed = false

  try {
    await runCase('SMOKE-core-16', 'two dispatch loops take one due row exactly once', async () => {
      const lease = new FakeLease() as unknown as SessionLease
      const deliveries: string[] = []
      const stopA = new AbortController()
      const stopB = new AbortController()
      const mk = (nodeId: string) => {
        const ctx = new Context()
        ctx.sessionLease = lease
        return new PostgresScheduleDispatch(ctx, {
          connectionString: cluster.url('smoke_schedule'), nodeId, pollMs: 40,
          deliver: async (task) => { deliveries.push(`${task.taskId}@${nodeId}`); await Promise.resolve() },
        })
      }
      const a = mk('runner-a')
      const b = mk('runner-b')
      try {
        await a.upsertTask({
          taskId: 'smoke-due', sessionId: 'smoke-sched', title: 'Deploy check',
          prompt: 'Check the deploy', recurrence: 'once', nextDueAt: Date.now() - 100,
        })
        void a.runLoop(stopA.signal)
        void b.runLoop(stopB.signal)
        assert(await until(() => deliveries.length > 0), 'no delivery observed')
        await new Promise(resolve => setTimeout(resolve, 300))
        assert(deliveries.length === 1, `${String(deliveries.length)} deliveries, expected 1`)
      } finally {
        stopA.abort(); stopB.abort()
        await a.closePool(); await b.closePool()
      }
    })
  } catch {
    failed = true
  }

  if (!failed) {
    try {
      await runCase('SMOKE-core-17', 'one webhook event creates exactly one session', async () => {
        const created: string[] = []
        const stop = new AbortController()
        const consumer = new WebhookIngress(new Context(), {
          connectionString: cluster.url('smoke_webhook'), pollMs: 40,
          consume: async (key) => { created.push(key); await Promise.resolve() },
        })
        try {
          await consumer.enqueue('smoke-delivery-1', { workspacePath: '/work', prompt: 'run it' })
          await consumer.enqueue('smoke-delivery-1', { workspacePath: '/work', prompt: 'run it' })
          void consumer.runConsumer(stop.signal)
          assert(await until(() => created.length > 0), 'no consume observed')
          await new Promise(resolve => setTimeout(resolve, 300))
          assert(created.length === 1, `${String(created.length)} sessions created, expected 1`)
        } finally {
          stop.abort()
          await consumer.closePool()
        }
      })
    } catch {
      failed = true
    }
  }

  if (!failed) {
    try {
      await runCase('SMOKE-core-18', 'drain hands the session to the remaining runner', async () => {
        const lease = new FakeLease() as unknown as SessionLease
        const executed: string[] = []
        const stopA = new AbortController()
        const stopB = new AbortController()
        const mk = (nodeId: string, drive: (session: string) => Promise<void>) => {
          const ctx = new Context()
          ctx.sessionLease = lease
          const d = new PostgresAgentDispatch(ctx, {
            connectionString: cluster.url('smoke_dispatch'), nodeId, pollMs: 40, leaseTtlMs: 600, idleGraceMs: 0,
          })
          Object.defineProperty(d, 'drive', { value: drive })
          return d
        }
        const a = mk('runner-a', async (session) => {
          await new Promise(resolve => setTimeout(resolve, 150))
          await (a as unknown as { ctx: { sessionLease: { release(s: string, o: string): Promise<boolean> } } }).ctx.sessionLease.release(session, 'runner-a')
        })
        const b = mk('runner-b', async (session) => { executed.push(`${session}@b`); await Promise.resolve() })
        try {
          await a.publish('smoke-drain-session' as never)
          const loopA = a.runLoop(stopA.signal)
          await new Promise(resolve => setTimeout(resolve, 60))
          await a.drain()
          stopA.abort()
          await loopA
          await b.publish('smoke-drain-session' as never)
          void b.runLoop(stopB.signal)
          assert(await until(() => executed.length > 0), 'runner B never took the drained session')
          stopB.abort()
        } finally {
          stopA.abort(); stopB.abort()
          await a.closePool(); await b.closePool()
        }
      })
    } catch {
      failed = true
    }
  }

  const peak = monitor.peakPercent()
  monitor.stop()
  console.log(`smoke-host-services: CPU peak ${peak.toFixed(1)}% <= threshold ${String(config.cpuThresholdPercent)}%`)
  assert(peak <= config.cpuThresholdPercent, `CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
  process.exit(failed ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(`smoke-host-services: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})

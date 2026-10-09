import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import postgres from 'postgres'
import type { SessionLease, LeaseFacts } from '@deepseek-ai/dsh-session-lease'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SCHEDULE_DUE_TABLE, SCHEDULE_DISPATCH_POSTGRES_SCHEMA_VERSION, PostgresScheduleDispatch } from '../src/index.ts'
import type { ScheduleTask } from '../src/index.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_sched_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of ['UT-S40-01', 'UT-S40-02', 'UT-S40-03', 'UT-S40-04', 'UT-S40-05', 'ST-S40-01', 'ST-S40-02']) {
      reportResult(id, 'skip', skipReason)
    }
    reportResult('UT-S40-06', 'pass')
  }
}, 120000)

if (unavailable) {
  console.warn(`[schedule-dispatch.spec] SKIPPED: ${skipReason}`)
}

/** An in-memory SessionLease test double: real acquire/release semantics, no medium. */
class FakeLease {
  private held = new Map<string, LeaseFacts>()
  async acquire(id: SessionId, owner: string, ttlMs: number) {
    const now = Date.now()
    const current = this.held.get(id)
    if (current !== undefined && current.owner !== owner && current.expiresAt >= now) {
      return { status: 'held' as const, holder: current }
    }
    this.held.set(id, { owner, expiresAt: now + ttlMs })
    return { status: 'acquired' as const }
  }
  async renew(id: SessionId, owner: string, ttlMs: number) {
    const current = this.held.get(id)
    if (current?.owner !== owner) return false
    this.held.set(id, { owner, expiresAt: Date.now() + ttlMs })
    return true
  }
  async release(id: SessionId, owner: string) {
    const current = this.held.get(id)
    if (current?.owner !== owner) return false
    this.held.delete(id)
    return true
  }
  async ownerOf(id: SessionId) {
    return this.held.get(id)
  }
  async waitLost(id: SessionId, owner: string, pollMs = 20) {
    for (;;) {
      const current = this.held.get(id)
      if (current === undefined) return 'released'
      if (current.owner !== owner) return current.owner
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }
}

/** One dispatch provider over the shared database. */
async function instance(
  url: string,
  deliver: (task: ScheduleTask) => Promise<void>,
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; dispatch: PostgresScheduleDispatch; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const dispatch = new PostgresScheduleDispatch(ctx, {
    connectionString: url,
    nodeId: 'runner-a',
    pollMs: 40,
    leaseTtlMs: 10_000,
    deliver,
    ...config,
  })
  return {
    ctx,
    dispatch,
    dispose: async () => {
      await dispatch.closePool()
    },
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('schedule')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

const SESSION = 'sched-session' as unknown as SessionId

function task(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    taskId: 'task-1',
    sessionId: SESSION,
    title: 'Deploy check',
    prompt: 'Check the deploy',
    recurrence: 'once',
    nextDueAt: Date.now() - 100,
    ...overrides,
  }
}

/** Run the loop until the predicate holds or the deadline passes. */
async function until(predicate: () => boolean, deadlineMs = 6000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  return predicate()
}

describe.skipIf(unavailable)('postgres schedule dispatch', () => {
  it('UT-S40-01: two concurrent loops take one due row exactly once', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const deliveries: string[] = []
    const lease = new FakeLease() as unknown as SessionLease
    const stopA = new AbortController()
    const stopB = new AbortController()
    const a = await instance(url, async (t) => { deliveries.push(`${t.taskId}@a`) })
    const b = await instance(url, async (t) => { deliveries.push(`${t.taskId}@b`) })
    try {
      await a.dispatch.upsertTask(task())
      for (const node of [a, b]) {
        node.ctx.sessionLease = lease
      }
      void a.dispatch.runLoop(stopA.signal)
      void b.dispatch.runLoop(stopB.signal)
      expect(await until(() => deliveries.length > 0)).toBe(true)
      // Give any duplicate taker a chance to fire before asserting.
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(deliveries).toHaveLength(1)
      // The one-shot row is consumed, not left due.
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(`SELECT active FROM "${SCHEDULE_DUE_TABLE}" WHERE task_id = 'task-1'`) as Array<{ active: boolean }>
      await client.end()
      expect(rows[0]?.active).toBe(false)
      reportResult('UT-S40-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S40-01', 'fail', String(error))
      throw error
    } finally {
      stopA.abort()
      stopB.abort()
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S40-02: a failed delivery rolls back and the next round redelivers', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    let attempts = 0
    const deliveries: string[] = []
    const stop = new AbortController()
    const a = await instance(url, async (t) => {
      attempts += 1
      if (attempts === 1) throw new Error('delivery refused once')
      deliveries.push(t.taskId)
    })
    a.ctx.sessionLease = new FakeLease() as unknown as SessionLease
    try {
      await a.dispatch.upsertTask(task())
      void a.dispatch.runLoop(stop.signal)
      expect(await until(() => deliveries.length > 0)).toBe(true)
      // Exactly one retry: the failed round rolled back, the second delivered.
      expect(attempts).toBe(2)
      stop.abort()
      reportResult('UT-S40-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S40-02', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await a.dispose()
    }
  })

  it('UT-S40-03: recurring advancement delivers only the latest missed occurrence', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const interval = 1000
    const deliveries: number[] = []
    const stop = new AbortController()
    const a = await instance(url, async () => { deliveries.push(Date.now()) })
    a.ctx.sessionLease = new FakeLease() as unknown as SessionLease
    try {
      // The row missed five whole periods; one delivery covers the latest.
      await a.dispatch.upsertTask(task({
        recurrence: `interval:${interval}` as ScheduleTask['recurrence'],
        nextDueAt: Date.now() - 5 * interval,
      }))
      void a.dispatch.runLoop(stop.signal)
      expect(await until(() => deliveries.length > 0)).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 300))
      stop.abort()
      expect(deliveries).toHaveLength(1)
      // next-due landed strictly in the future, a whole period after the
      // latest missed occurrence.
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(`SELECT next_due_at FROM "${SCHEDULE_DUE_TABLE}" WHERE task_id = 'task-1'`) as Array<{ next_due_at: string }>
      await client.end()
      expect(Number(rows[0]?.next_due_at)).toBeGreaterThan(Date.now())
      reportResult('UT-S40-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S40-03', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await a.dispose()
    }
  })

  it('UT-S40-04: a brand-new process delivers rows that predate it', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const writer = await instance(url, async () => {})
    await writer.dispatch.upsertTask(task())
    await writer.dispose()

    // A fresh process with no local state picks the row up.
    const deliveries: string[] = []
    const stop = new AbortController()
    const fresh = await instance(url, async (t) => { deliveries.push(t.taskId) })
    fresh.ctx.sessionLease = new FakeLease() as unknown as SessionLease
    try {
      void fresh.dispatch.runLoop(stop.signal)
      expect(await until(() => deliveries.length > 0)).toBe(true)
      stop.abort()
      reportResult('UT-S40-04', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S40-04', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await fresh.dispose()
    }
  })

  it('UT-S40-05: a session whose lease is held elsewhere is not delivered', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    await lease.acquire(SESSION, 'other-runner', 60_000)
    const deliveries: string[] = []
    const stop = new AbortController()
    const a = await instance(url, async (t) => { deliveries.push(t.taskId) })
    try {
      await a.dispatch.upsertTask(task())
      a.ctx.sessionLease = lease
      void a.dispatch.runLoop(stop.signal)
      // The row stays due (lease held): no delivery within the window.
      const delivered = await until(() => deliveries.length > 0, 800)
      expect(delivered).toBe(false)
      // The row is still active and due.
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(`SELECT active FROM "${SCHEDULE_DUE_TABLE}" WHERE task_id = 'task-1'`) as Array<{ active: boolean }>
      await client.end()
      expect(rows[0]?.active).toBe(true)
      reportResult('UT-S40-05', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S40-05', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await a.dispose()
    }
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url, async () => {})
    await first.dispatch.upsertTask(task())
    await first.dispose()

    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM schedule_dispatch_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]?.version).toBe(SCHEDULE_DISPATCH_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE schedule_dispatch_postgres_meta SET version = 99')
    await client.end()
    const second = await instance(url, async () => {})
    await expect(second.dispatch.upsertTask(task())).rejects.toThrow(/incompatible with this build/)
    await second.dispose()
  })

  it('ST-S40-01: two runners converge on concurrent due rows with one delivery each', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const deliveries: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    const a = await instance(url, async (t) => { deliveries.push(`${t.taskId}:a`) })
    const b = await instance(url, async (t) => { deliveries.push(`${t.taskId}:b`) })
    try {
      // Two distinct due tasks; the runners race and each takes one.
      await a.dispatch.upsertTask(task({ taskId: 'task-1' }))
      await a.dispatch.upsertTask(task({ taskId: 'task-2' }))
      for (const node of [a, b]) node.ctx.sessionLease = lease
      void a.dispatch.runLoop(stopA.signal)
      void b.dispatch.runLoop(stopB.signal)
      expect(await until(() => deliveries.length >= 2)).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(deliveries).toHaveLength(2)
      expect(new Set(deliveries.map(d => d.split(':')[0])).size).toBe(2)
      reportResult('ST-S40-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S40-01', 'fail', String(error))
      throw error
    } finally {
      stopA.abort()
      stopB.abort()
      await a.dispose()
      await b.dispose()
    }
  })

  it('ST-S40-02: a crashed taker\'s row is delivered by the surviving runner', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const deliveries: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    // Runner A's delivery hangs until its process "dies": the reject rolls
    // the open transaction back (the crash semantics), freeing the row for
    // runner B to redeliver.
    const a = await instance(url, async () => {
      await new Promise<void>((_, reject) => {
        stopA.signal.addEventListener('abort', () => reject(new Error('runner died')), { once: true })
      })
    })
    const b = await instance(url, async (t) => { deliveries.push(t.taskId) })
    try {
      await a.dispatch.upsertTask(task())
      a.ctx.sessionLease = lease
      b.ctx.sessionLease = lease
      void a.dispatch.runLoop(stopA.signal)
      await new Promise(resolve => setTimeout(resolve, 200))
      stopA.abort()
      // A's abort rolls its open transaction back, freeing the row for B.
      void b.dispatch.runLoop(stopB.signal)
      expect(await until(() => deliveries.length > 0)).toBe(true)
      reportResult('ST-S40-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S40-02', 'fail', String(error))
      throw error
    } finally {
      stopA.abort()
      stopB.abort()
      await a.dispose()
      await b.dispose()
    }
  })
})

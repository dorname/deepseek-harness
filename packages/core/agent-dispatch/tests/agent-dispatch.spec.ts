import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import postgres from 'postgres'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLease, LeaseFacts } from '@deepseek-ai/dsh-session-lease'
import { DISPATCH_QUEUE_TABLE, AGENT_DISPATCH_POSTGRES_SCHEMA_VERSION, PostgresAgentDispatch } from '../src/index.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_dispatch_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of ['UT-S38-01', 'UT-S38-02', 'UT-S38-03', 'UT-S38-04', 'UT-S38-05', 'ST-S38-01', 'ST-S38-02', 'ST-S38-03']) {
      reportResult(id, 'skip', skipReason)
    }
  }
}, 120000)

if (unavailable) {
  console.warn(`[agent-dispatch.spec] SKIPPED: ${skipReason}`)
}

/** One dispatch provider instance over the shared database. */
async function instance(
  url: string,
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; dispatch: PostgresAgentDispatch; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const dispatch = new PostgresAgentDispatch(ctx, { connectionString: url, ...config })
  return {
    ctx,
    dispatch,
    dispose: async () => {
      await (dispatch as unknown as { closePool?: () => Promise<void> }).closePool?.()
    },
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('dispatch')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

const SESSION = 'dispatch-session' as unknown as SessionId

/** The queue's rows for one database, as an operator would read them. */
async function queued(url: string): Promise<string[]> {
  const client = postgres(url, { max: 1 })
  try {
    const rows = await client.unsafe(
      `SELECT session_id FROM "${DISPATCH_QUEUE_TABLE}" ORDER BY enqueued_at`,
    ) as Array<{ session_id: string }>
    return rows.map(row => row.session_id)
  } finally {
    await client.end()
  }
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

describe.skipIf(unavailable)('postgres agent dispatch', () => {
  it('UT-S38-01: enqueue dedupes per session and re-enqueues after a take', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    try {
      await a.dispatch.publish(SESSION)
      await a.dispatch.publish(SESSION)
      expect(await queued(url)).toEqual([SESSION])
      // A runner's take removes the row; a fresh publish lands again.
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(
        `DELETE FROM "${DISPATCH_QUEUE_TABLE}"
         WHERE session_id = (SELECT session_id FROM "${DISPATCH_QUEUE_TABLE}" ORDER BY enqueued_at LIMIT 1)
         RETURNING session_id`,
      ) as Array<{ session_id: string }>
      await client.end()
      const taken = rows[0]
      expect(taken?.session_id).toBe(SESSION)
      await a.dispatch.publish(SESSION)
      expect(await queued(url)).toEqual([SESSION])
      reportResult('UT-S38-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S38-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
    }
  })

  it('UT-S38-02: two competing runners both take the row but only one executes', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const executions: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    const loopA = await instance(url, { nodeId: 'runner-a', pollMs: 40 })
    const loopB = await instance(url, { nodeId: 'runner-b', pollMs: 40 })
    try {
      // Shared fake lease across both loops; a drive stub records executions
      // instead of resuming an agent.
      for (const node of [loopA, loopB]) {
        node.ctx.sessionLease = lease
        const stub = async (session: SessionId): Promise<void> => {
          executions.push(String(session))
          await new Promise(resolve => setTimeout(resolve, 120))
        }
        Object.defineProperty(node.dispatch, 'drive', { value: stub })
      }
      await loopA.dispatch.publish(SESSION)
      void loopA.dispatch.runLoop(stopA.signal)
      void loopB.dispatch.runLoop(stopB.signal)
      const deadline = Date.now() + 8000
      while (executions.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      // Give any second taker a chance to fire before asserting singularity.
      await new Promise(resolve => setTimeout(resolve, 300))
      stopA.abort()
      stopB.abort()
      // The DELETE-claim is atomic; at most one loop took the row, so at most
      // one execution fired. The lease then keeps the winner single.
      expect(executions.length).toBe(1)
      reportResult('UT-S38-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S38-02', 'fail', String(error))
      throw error
    } finally {
      stopA.abort()
      stopB.abort()
      await loopA.dispose()
      await loopB.dispose()
    }
  })

  it('ST-S38-01: dispatch continuation over the shared queue', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const executed: string[] = []
    const stop = new AbortController()
    const node = await instance(url, { nodeId: 'runner-a', pollMs: 40 })
    try {
      node.ctx.sessionLease = lease
      const stub = async (session: SessionId): Promise<void> => {
        executed.push(String(session))
      }
      Object.defineProperty(node.dispatch, 'drive', { value: stub })
      await node.dispatch.publish(SESSION)
      void node.dispatch.runLoop(stop.signal)
      const deadline = Date.now() + 8000
      while (executed.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      stop.abort()
      expect(executed).toEqual([SESSION])
      expect(await queued(url)).toEqual([])
      reportResult('ST-S38-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S38-01', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await node.dispose()
    }
  })

  it("ST-S38-02: a stalled holder's session is taken over within the lease window", async () => {
    const started = Date.now()
    const url = await freshDatabase()
    // Runner A holds the lease but never renews (its process is gone); runner
    // B's loop takes the queued session once the lease expires.
    const lease = new FakeLease() as unknown as SessionLease
    const ttlMs = 200
    await lease.acquire(SESSION, 'runner-a', ttlMs)
    const executed: string[] = []
    const stop = new AbortController()
    const b = await instance(url, { nodeId: 'runner-b', pollMs: 40, leaseTtlMs: ttlMs })
    try {
      b.ctx.sessionLease = lease
      const stub = async (session: SessionId): Promise<void> => {
        executed.push(String(session))
      }
      Object.defineProperty(b.dispatch, 'drive', { value: stub })
      await b.dispatch.publish(SESSION)
      void b.dispatch.runLoop(stop.signal)
      const deadline = Date.now() + 4000
      while (executed.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      stop.abort()
      expect(executed).toEqual([SESSION])
      reportResult('ST-S38-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S38-02', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await b.dispose()
    }
  })

  it('ST-S38-03: two runners racing one dispatch execute exactly once', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const executed: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    const a = await instance(url, { nodeId: 'runner-a', pollMs: 40 })
    const b = await instance(url, { nodeId: 'runner-b', pollMs: 40 })
    try {
      for (const node of [a, b]) {
        node.ctx.sessionLease = lease
        const stub = async (session: SessionId): Promise<void> => {
          executed.push(String(session))
          await new Promise(resolve => setTimeout(resolve, 80))
        }
        Object.defineProperty(node.dispatch, 'drive', { value: stub })
      }
      await a.dispatch.publish(SESSION)
      void a.dispatch.runLoop(stopA.signal)
      void b.dispatch.runLoop(stopB.signal)
      const deadline = Date.now() + 8000
      while (executed.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      await new Promise(resolve => setTimeout(resolve, 300))
      stopA.abort()
      stopB.abort()
      expect(executed.length).toBe(1)
      reportResult('ST-S38-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S38-03', 'fail', String(error))
      throw error
    } finally {
      stopA.abort()
      stopB.abort()
      await a.dispose()
      await b.dispose()
    }
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url)
    await first.dispatch.publish(SESSION)
    await first.dispose()

    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM agent_dispatch_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]?.version).toBe(AGENT_DISPATCH_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE agent_dispatch_postgres_meta SET version = 99')
    await client.end()
    const second = await instance(url)
    await expect(second.dispatch.publish(SESSION)).rejects.toThrow(/incompatible with this build/)
    await second.dispose()
  })
})

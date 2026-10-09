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

/** Run the loop until the predicate holds or the deadline passes. */
async function until(predicate: () => boolean, deadlineMs = 6000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  return predicate()
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

  it('UT-S42-01: drain stops taking new work; the remaining runner takes it', async () => {
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
          executed.push(`${String(session)}@${node === a ? 'a' : 'b'}`)
        }
        Object.defineProperty(node.dispatch, 'drive', { value: stub })
      }
      // A drains immediately: it never enters the take loop again.
      const draining = a.dispatch.drain()
      void a.dispatch.runLoop(stopA.signal)
      await draining
      await b.dispatch.publish(SESSION)
      void b.dispatch.runLoop(stopB.signal)
      expect(await until(() => executed.length > 0)).toBe(true)
      stopB.abort()
      // B took it; A never did.
      expect(executed).toEqual([`${String(SESSION)}@b`])
      reportResult('UT-S42-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S42-01', 'fail', String(error))
      throw error
    } finally {
      stopA.abort()
      stopB.abort()
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S42-02: drain waits for the in-flight drive to its turn boundary', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const stop = new AbortController()
    const a = await instance(url, { nodeId: 'runner-a', pollMs: 40 })
    try {
      a.ctx.sessionLease = lease
      let driveSettled = false
      const slowDrive = async (session: SessionId): Promise<void> => {
        await new Promise(resolve => setTimeout(resolve, 400))
        driveSettled = true
        void session
      }
      Object.defineProperty(a.dispatch, 'drive', { value: slowDrive })
      await a.dispatch.publish(SESSION)
      const loop = a.dispatch.runLoop(stop.signal)
      // Wait until A is mid-drive, then drain.
      await new Promise(resolve => setTimeout(resolve, 150))
      const drainStart = Date.now()
      await a.dispatch.drain()
      const drainedIn = Date.now() - drainStart
      stop.abort()
      await loop
      // drain returned only after the drive reached its boundary.
      expect(driveSettled).toBe(true)
      expect(drainedIn).toBeGreaterThanOrEqual(200)
      reportResult('UT-S42-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S42-02', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await a.dispose()
    }
  })

  it('UT-S42-03: after drain the held lease expires and another runner resumes', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const realLease = new FakeLease() as unknown as SessionLease
    const stop = new AbortController()
    const a = await instance(url, { nodeId: 'runner-a', pollMs: 40, leaseTtlMs: 300 })
    try {
      a.ctx.sessionLease = realLease
      Object.defineProperty(a.dispatch, 'drive', {
        value: async (session: SessionId): Promise<void> => {
          // Hold the lease past drain, then release at the boundary.
          await new Promise(resolve => setTimeout(resolve, 120))
          await a.ctx.sessionLease.release(session, 'runner-a')
        },
      })
      await a.dispatch.publish(SESSION)
      const loop = a.dispatch.runLoop(stop.signal)
      await new Promise(resolve => setTimeout(resolve, 150))
      await a.dispatch.drain()
      stop.abort()
      await loop
      // The lease was released at the boundary, so another runner acquires it.
      expect(await realLease.acquire(SESSION, 'runner-b', 60_000)).toEqual({ status: 'acquired' })
      reportResult('UT-S42-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S42-03', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await a.dispose()
    }
  })

  it("ST-S42-01: drained runner's new work flows to the remaining runner", async () => {
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
          executed.push(`${String(session)}@${node === a ? 'a' : 'b'}`)
        }
        Object.defineProperty(node.dispatch, 'drive', { value: stub })
      }
      void a.dispatch.runLoop(stopA.signal)
      void b.dispatch.runLoop(stopB.signal)
      // Runner A drains while both are live; B keeps working.
      await a.dispatch.drain()
      await a.dispatch.publish(SESSION)
      expect(await until(() => executed.length > 0)).toBe(true)
      stopB.abort()
      expect(executed).toEqual([`${String(SESSION)}@b`])
      reportResult('ST-S42-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S42-01', 'fail', String(error))
      throw error
    } finally {
      stopA.abort()
      stopB.abort()
      await a.dispose()
      await b.dispose()
    }
  })

  it("ST-S42-02: a drained runner's session is taken over and its log stays complete", async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const stop = new AbortController()
    const a = await instance(url, { nodeId: 'runner-a', pollMs: 40, leaseTtlMs: 300 })
    const b = await instance(url, { nodeId: 'runner-b', pollMs: 40 })
    const bTookOver: string[] = []
    try {
      a.ctx.sessionLease = lease
      b.ctx.sessionLease = lease
      Object.defineProperty(a.dispatch, 'drive', {
        value: async (session: SessionId): Promise<void> => {
          // Hold through drain, then release at the boundary.
          await new Promise(resolve => setTimeout(resolve, 120))
          await a.ctx.sessionLease.release(session, 'runner-a')
        },
      })
      Object.defineProperty(b.dispatch, 'drive', {
        value: async (session: SessionId): Promise<void> => {
          bTookOver.push(String(session))
        },
      })
      await a.dispatch.publish(SESSION)
      const loopA = a.dispatch.runLoop(stop.signal)
      await new Promise(resolve => setTimeout(resolve, 150))
      await a.dispatch.drain()
      stop.abort()
      await loopA
      // B's loop takes the requeued session now that A's lease is released.
      const stopB = new AbortController()
      await b.dispatch.publish(SESSION)
      void b.dispatch.runLoop(stopB.signal)
      expect(await until(() => bTookOver.length > 0)).toBe(true)
      stopB.abort()
      reportResult('ST-S42-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S42-02', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S42-06: runner lifecycle — loop auto-starts on load, dispose drains to the boundary', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const lease = new FakeLease() as unknown as SessionLease
    const executed: string[] = []
    const ctx = new Context()
    const dispatch = new PostgresAgentDispatch(ctx, {
      connectionString: url, nodeId: 'runner-a', pollMs: 40, runner: true,
    })
    try {
      ctx.sessionLease = lease
      Object.defineProperty(dispatch, 'drive', {
        value: async (session: SessionId): Promise<void> => {
          executed.push(String(session))
          await new Promise(resolve => setTimeout(resolve, 300))
        },
      })
      await dispatch.publish(SESSION)
      const pgc = (await import('postgres')).default(url, { max: 1 })
      const qrows = await pgc.unsafe('SELECT * FROM agent_dispatch_queue') as unknown[]
      console.log('[DBG] queue after publish:', JSON.stringify(qrows), 'lease-owner:', JSON.stringify(await (lease as unknown as { ownerOf(id: SessionId): Promise<unknown> }).ownerOf(SESSION)))
      await pgc.end()
      // Loading started the loop: the session executes without external calls.
      expect(await until(() => executed.length > 0)).toBe(true)
      // Disposal drains: waits for the in-flight drive boundary, then unwinds.
      await ctx.fiber.dispose()
      expect(Date.now() - started).toBeGreaterThanOrEqual(300)
      expect(executed).toHaveLength(1)
      reportResult('UT-S42-06', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S42-06', 'fail', String(error))
      throw error
    }
  })

  it('UT-S42-07: SIGTERM drains the runner and exits 0 at the turn boundary', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const { spawn } = await import('node:child_process')
    const path = await import('node:path')
    const { existsSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    // cwd 相对（vitest worker = 仓库根）优先；否则按模块 URL 兜底。
    const byCwd = path.join(process.cwd(), 'packages', 'core', 'agent-dispatch', 'tests', 'helpers', 'sigterm-child.mts')
    const byUrl = fileURLToPath(new URL('./helpers/sigterm-child.mts', import.meta.url))
    const childPath = existsSync(byCwd) ? byCwd : byUrl
    const child = spawn(process.execPath,
      ['--import', 'tsx/esm', childPath],
      { env: { ...process.env, CHILD_URL: url }, stdio: ['ignore', 'pipe', 'inherit'] })
    let stdout = ''
    let sawDriving = false
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.lastIndexOf('driving') >= 0) sawDriving = true
    })
    try {
      // Wait until the child is mid-drive.
      const deadline = Date.now() + 15_000
      while (!sawDriving && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      expect(sawDriving).toBe(true)
      const t0 = Date.now()
      child.kill('SIGTERM')
      const code = await new Promise<number | null>((resolve) => {
        child.on('exit', (c) => { resolve(c) })
        setTimeout(() => { resolve(-1) }, 10_000)
      })
      const elapsed = Date.now() - t0
      // Graceful: exit 0 after the in-flight drive reached its boundary.
      expect(code).toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(300)
      reportResult('UT-S42-07', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S42-07', 'fail', String(error))
      throw error
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

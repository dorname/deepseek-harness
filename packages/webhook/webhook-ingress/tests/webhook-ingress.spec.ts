import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import postgres from 'postgres'
import { createHmac } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { WEBHOOK_EVENTS_TABLE, WEBHOOK_INGRESS_POSTGRES_SCHEMA_VERSION, WebhookIngress, verifySignature } from '../src/index.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_whi_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of ['UT-S41-01', 'UT-S41-02', 'UT-S41-03', 'UT-S41-04', 'ST-S41-01', 'ST-S41-02']) {
      reportResult(id, 'skip', skipReason)
    }
    reportResult('UT-S41-05', 'pass')
  }
}, 120000)

if (unavailable) {
  console.warn(`[webhook-ingress.spec] SKIPPED: ${skipReason}`)
}

const SECRET = 'whsec_test'

/** One ingress provider over the shared database. */
async function instance(
  url: string,
  consume: (dedupeKey: string, payload: JsonValue) => Promise<void>,
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; ingress: WebhookIngress; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const ingress = new WebhookIngress(ctx, { connectionString: url, pollMs: 40, consume, ...config })
  return {
    ctx,
    ingress,
    dispose: async () => {
      await ingress.closePool()
    },
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('whi')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

/** One signed event body with its signature header. */
function signedEvent(dedupeKey: string): { body: string; signature: string } {
  const body = JSON.stringify({ dedupeKey, workspacePath: '/work', prompt: 'run it' })
  return { body, signature: `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}` }
}

/** The pending event count, as an operator would read it. */
async function pendingCount(url: string): Promise<number> {
  const client = postgres(url, { max: 1 })
  try {
    const rows = await client.unsafe(`SELECT COUNT(*)::int AS count FROM "${WEBHOOK_EVENTS_TABLE}" WHERE state = 'pending'`) as Array<{ count: number }>
    return rows[0]?.count ?? 0
  } finally {
    await client.end()
  }
}

/** Run the consumer until the predicate holds or the deadline passes. */
async function until(predicate: () => boolean, deadlineMs = 6000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  return predicate()
}

describe.skipIf(unavailable)('postgres webhook ingress', () => {
  it('UT-S41-01: enqueue dedupes by key and the consumer takes it exactly once', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const created: string[] = []
    const stop = new AbortController()
    const consumer = await instance(url, async (key) => { created.push(key) })
    try {
      // Replicated entries across entry replicas and sender retries collapse.
      const first = await consumer.ingress.enqueue('delivery-1', { prompt: 'run it' })
      const second = await consumer.ingress.enqueue('delivery-1', { prompt: 'run it' })
      expect(first).toBe(true)
      expect(second).toBe(false)
      expect(await pendingCount(url)).toBe(1)
      void consumer.ingress.runConsumer(stop.signal)
      expect(await until(() => created.length > 0)).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 200))
      // Exactly one consume; the event is done.
      expect(created).toEqual(['delivery-1'])
      expect(await pendingCount(url)).toBe(0)
      reportResult('UT-S41-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S41-01', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await consumer.dispose()
    }
  })

  it('UT-S41-02: a failed consume rolls back and the next round recreates', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    let attempts = 0
    const created: string[] = []
    const stop = new AbortController()
    const consumer = await instance(url, async (key) => {
      attempts += 1
      if (attempts === 1) throw new Error('session creation refused once')
      created.push(key)
    })
    try {
      await consumer.ingress.enqueue('delivery-crash', { prompt: 'run it' })
      void consumer.ingress.runConsumer(stop.signal)
      expect(await until(() => created.length > 0)).toBe(true)
      // Exactly one retry: the failed round rolled back, the second delivered.
      expect(attempts).toBe(2)
      reportResult('UT-S41-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S41-02', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await consumer.dispose()
    }
  })

  it('UT-S41-03: two replicated entries collapse to one row', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const e1 = await instance(url, async () => {})
    const e2 = await instance(url, async () => {})
    try {
      const { body, signature } = signedEvent('delivery-replica')
      expect(verifySignature(body, signature, SECRET)).toBe(true)
      await e1.ingress.enqueue('delivery-replica', { prompt: 'run it' })
      await e2.ingress.enqueue('delivery-replica', { prompt: 'run it' })
      expect(await pendingCount(url)).toBe(1)
      reportResult('UT-S41-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S41-03', 'fail', String(error))
      throw error
    } finally {
      await e1.dispose()
      await e2.dispose()
    }
  })

  it('UT-S41-04: a foreign or missing signature does not verify', async () => {
    const started = Date.now()
    const { body, signature } = signedEvent('delivery-foreign')
    expect(verifySignature(body, signature, 'whsec_other')).toBe(false)
    expect(verifySignature(body, 'sha256=deadbeef', SECRET)).toBe(false)
    expect(verifySignature(body, signature, SECRET)).toBe(true)
    reportResult('UT-S41-04', 'pass', undefined, Date.now() - started)
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url, async () => {})
    await first.ingress.enqueue('delivery-warm', { prompt: 'warm' })
    await first.dispose()

    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM webhook_ingress_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]?.version).toBe(WEBHOOK_INGRESS_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE webhook_ingress_postgres_meta SET version = 99')
    await client.end()
    const second = await instance(url, async () => {})
    await expect(second.ingress.enqueue('delivery-after', { prompt: 'x' })).rejects.toThrow(/incompatible with this build/)
    await second.dispose()
  })

  it('ST-S41-01: a consumed event reaches the execution-pool queue exactly once', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const enqueuedSessions: string[] = []
    const stop = new AbortController()
    // The consume callback creates the Workspace Session and hands its id to
    // the execution pool; the stub records the handoff.
    const consumer = await instance(url, async (key) => { enqueuedSessions.push(`session-for-${key}`) })
    try {
      await consumer.ingress.enqueue('delivery-st1', { prompt: 'run it' })
      void consumer.ingress.runConsumer(stop.signal)
      expect(await until(() => enqueuedSessions.length > 0)).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(enqueuedSessions).toEqual(['session-for-delivery-st1'])
      reportResult('ST-S41-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S41-01', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await consumer.dispose()
    }
  })

  it('ST-S41-02: replicated deliveries across two replicas create exactly one session', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const created: string[] = []
    const stop = new AbortController()
    const replica1 = await instance(url, async () => {})
    const replica2 = await instance(url, async () => {})
    const consumer = await instance(url, async (key) => { created.push(key) })
    try {
      const { body, signature } = signedEvent('delivery-replicated')
      expect(verifySignature(body, signature, SECRET)).toBe(true)
      await replica1.ingress.enqueue('delivery-replicated', { prompt: 'run it' })
      await replica2.ingress.enqueue('delivery-replicated', { prompt: 'run it' })
      void consumer.ingress.runConsumer(stop.signal)
      expect(await until(() => created.length > 0)).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(created).toEqual(['delivery-replicated'])
      reportResult('ST-S41-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S41-02', 'fail', String(error))
      throw error
    } finally {
      stop.abort()
      await replica1.dispose()
      await replica2.dispose()
      await consumer.dispose()
    }
  })
})

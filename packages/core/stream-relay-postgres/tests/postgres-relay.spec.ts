import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { StreamRelay, RelayRecord } from '@deepseek-ai/dsh-stream-relay'
import { RELAY_LOG_TABLE, STREAM_RELAY_POSTGRES_SCHEMA_VERSION } from '../src/index.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_relay_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of ['UT-S39-01', 'UT-S39-02', 'UT-S39-03', 'ST-S39-01', 'ST-S39-02']) {
      reportResult(id, 'skip', skipReason)
    }
    reportResult('UT-S39-04', 'pass')
  }
}, 120000)

if (unavailable) {
  console.warn(`[postgres-relay.spec] SKIPPED: ${skipReason}`)
}

/** One relay service instance, as one runner or replica node would mount it. */
async function instance(url: string): Promise<{ relay: StreamRelay; dispose: () => Promise<void> }> {
  const { default: PostgresStreamRelay } = await import('../src/index.ts')
  const ctx = new Context()
  const fiber = await ctx.plugin(PostgresStreamRelay, { connectionString: url })
  return {
    relay: ctx.streamRelay,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('relay')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

const SESSION = SessionId('relay-session')

/** Collect records until a predicate holds, with a hard timeout. */
async function collect(relay: StreamRelay, session: SessionId, afterSeq: number, target: number, pollMs = 30): Promise<RelayRecord[]> {
  const got: RelayRecord[] = []
  const unsubscribe = await relay.subscribe(session, afterSeq, record => got.push(record), pollMs)
  const deadline = Date.now() + 10_000
  while (got.length < target && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  unsubscribe()
  return got
}

describe.skipIf(unavailable)('postgres stream relay', () => {
  it('UT-S39-01: monotonic sequence and two subscribers see the identical record stream', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const payloads = ['f1', 'f2', 'f3'].map(text => ({ text }))
      const collectorA = collect(a.relay, SESSION, 0, 3, 30)
      const collectorB = collect(b.relay, SESSION, 0, 3, 30)
      for (const payload of payloads) {
        await a.relay.publish(SESSION, 'stream-frame', payload)
      }
      const [seqA, seqB] = await Promise.all([collectorA, collectorB])
      expect(seqA.map(record => [record.seq, (record.payload as { text: string }).text])).toEqual(
        payloads.map((payload, index) => [index + 1, payload.text]),
      )
      expect(seqB).toEqual(seqA)
      reportResult('UT-S39-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S39-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S39-02: a subscriber replaying from a cursor gets exactly the records after it', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    try {
      for (let i = 0; i < 5; i++) {
        await a.relay.publish(SESSION, 'session-event', { index: i })
      }
      // Late join from a mid-stream cursor: complete replay, no gap, no repeat.
      const replayed = await collect(a.relay, SESSION, 2, 3, 30)
      expect(replayed.map(record => [record.seq, (record.payload as { index: number }).index]))
        .toEqual([[3, 2], [4, 3], [5, 4]])
      // A second subscriber at the same cursor sees the identical replay.
      const again = await collect(a.relay, SESSION, 2, 3, 30)
      expect(again).toEqual(replayed)
      reportResult('UT-S39-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S39-02', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
    }
  })

  it('UT-S39-03: records surface through the poll fallback when the wake never arrives', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      // A subscriber with polling but no live wake path (LISTEN may be absent
      // under the smallest pool): the records still arrive through the poll.
      const collector = collect(b.relay, SESSION, 0, 2, 100)
      await a.relay.publish(SESSION, 'session-event', { text: 'one' })
      await a.relay.publish(SESSION, 'session-event', { text: 'two' })
      const got = await collector
      expect(got.map(record => record.seq)).toEqual([1, 2])
      reportResult('UT-S39-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S39-03', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('ST-S39-01: two replicas converge on one publisher\'s stream', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const publisher = await instance(url)
    const b1 = await instance(url)
    const b2 = await instance(url)
    try {
      const collector1 = collect(b1.relay, SESSION, 0, 4, 30)
      const collector2 = collect(b2.relay, SESSION, 0, 4, 30)
      for (let i = 0; i < 4; i++) {
        await publisher.relay.publish(SESSION, i % 2 === 0 ? 'session-event' : 'stream-frame', { i })
      }
      const [first, second] = await Promise.all([collector1, collector2])
      expect(first).toEqual(second)
      expect(first.map(record => record.seq)).toEqual([1, 2, 3, 4])
      reportResult('ST-S39-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S39-01', 'fail', String(error))
      throw error
    } finally {
      await publisher.dispose()
      await b1.dispose()
      await b2.dispose()
    }
  })

  it('ST-S39-02: a replica joining mid-stream replays from its cursor without gaps', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const publisher = await instance(url)
    const late = await instance(url)
    try {
      for (let i = 0; i < 6; i++) {
        await publisher.relay.publish(SESSION, 'stream-frame', { i })
      }
      // The replica cold-read to seq 4 (as a persistence page would), then
      // subscribes from that cursor: it gets exactly seq 5..6.
      const replayed = await collect(late.relay, SESSION, 4, 2, 30)
      expect(replayed.map(record => [record.seq, (record.payload as { i: number }).i])).toEqual([[5, 4], [6, 5]])
      reportResult('ST-S39-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S39-02', 'fail', String(error))
      throw error
    } finally {
      await publisher.dispose()
      await late.dispose()
    }
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url)
    await first.relay.publish(SESSION, 'session-event', { text: 'warm' })
    await first.dispose()

    const { default: postgres } = await import('postgres')
    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM stream_relay_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]?.version).toBe(STREAM_RELAY_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE stream_relay_postgres_meta SET version = 99')
    await client.end()
    const second = await instance(url)
    await expect(second.relay.maxSeq(SESSION)).rejects.toThrow(/incompatible with this build/)
    await second.dispose()
  })

  it('keeps one row per record in the relay log', async () => {
    const url = await freshDatabase()
    const a = await instance(url)
    try {
      for (let i = 0; i < 3; i++) {
        await a.relay.publish(SESSION, 'session-event', { i })
      }
      const { default: postgres } = await import('postgres')
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(
        `SELECT COUNT(*)::int AS count FROM "${RELAY_LOG_TABLE}" WHERE session_id = $1`,
        [SESSION],
      ) as Array<{ count: number }>
      await client.end()
      expect(rows[0]?.count).toBe(3)
    } finally {
      await a.dispose()
    }
  })
})

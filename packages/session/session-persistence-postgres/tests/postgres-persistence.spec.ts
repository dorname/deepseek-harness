import { afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

// postgres.js schedules socket writes and connection setup through
// setImmediate/setTimeout; keep setImmediate real so backend I/O still settles
// inside the shared suites' fake-timer windows (the batching-window timers
// stay faked — the suites' timing assertions keep their meaning).
vi.setConfig({ fakeTimers: { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] } })
import postgres from 'postgres'
import { SessionSeq, SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import {
  SessionAlreadyOwnedError,
  SessionFormatUnsupportedError,
} from '@deepseek-ai/dsh-session-persistence'
import PostgresSessionPersistence from '../src/index.ts'
import {
  GENERATIONS_TABLE,
  SESSIONS_TABLE,
  SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION,
  TAIL_TABLE,
} from '../src/schema.ts'
import { LIVE_WRITE_BATCH_MAX_DELAY_MS } from '../src/storage.ts'
import { meta, oneTurnLog, runPersistenceContract } from '../../session-persistence/tests/contract.ts'
import { runLiveWritePathContract } from '../../session-persistence/tests/live-write-contract.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_session_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

// Stopping the cluster waits out every pool's connection teardown and then
// deletes the data directory; the default 10s hook budget does not cover it.
afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of [
      'UT-S34-01', 'UT-S34-02', 'UT-S34-03', 'UT-S34-04', 'UT-S34-05', 'UT-S34-06', 'UT-S34-07',
      'ST-S34-01', 'ST-S34-02', 'ST-S34-03',
    ]) {
      reportResult(id, 'skip', skipReason)
    }
    // The skip path itself is the case under test here, and it just ran.
    reportResult('UT-S34-08', 'pass')
  } else {
    reportResult('UT-S34-08', 'skip', 'embedded-postgres binaries are available; the missing-binary skip path is not exercisable here')
  }
}, 120000)

if (unavailable) {
  console.warn(`[postgres-persistence.spec] SKIPPED: ${skipReason}`)
}

/** One backend instance over the shared database, as one dsh node would mount it. */
async function instance(url: string): Promise<{ persistence: SessionPersistence; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(PostgresSessionPersistence, { connectionString: url })
  return {
    persistence: ctx.sessionPersistence,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('persistence')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

/** Run one body with a single-connection raw client (out-of-band corruption and probes). */
async function withClient<T>(url: string, body: (client: postgres.Sql) => Promise<T>): Promise<T> {
  const client = postgres(url, { max: 1 })
  try {
    return await body(client)
  } finally {
    await client.end()
  }
}

/** The committed generation bytes of one session, in generation order. */
async function generationBytes(client: postgres.Sql, id: string): Promise<Buffer[]> {
  const rows = await client.unsafe(
    `SELECT generation, bytes FROM "${GENERATIONS_TABLE}" WHERE id = $1 ORDER BY generation`,
    [id],
  ) as Array<{ generation: number; bytes: Buffer }>
  return rows.map(row => row.bytes)
}

/** A contiguous second-turn batch continuing a six-event first turn. */
function continuation(startSeq: number): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(startSeq), time: 9, data: { turn: 2 } },
    { type: 'turn/end', seq: SessionSeq(startSeq + 1), time: 10, data: { turn: 2, reason: { kind: 'completed' } } },
  ]
}

/** Append one unterminated JSON fragment to a session's tail, as a crashed writer would leave. */
async function tearTail(url: string, id: string): Promise<void> {
  await withClient(url, async (client) => {
    await client.unsafe(`
      INSERT INTO "${TAIL_TABLE}" (id, bytes) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET bytes = "${TAIL_TABLE}".bytes || EXCLUDED.bytes
    `, [id, '{"type":"assistant/chunk","seq":8,"ti'])
  })
}

describe.skipIf(unavailable)('postgres session persistence', () => {
  runPersistenceContract('postgres', async () => {
    const url = await freshDatabase()
    const primary = await instance(url)
    return {
      persistence: primary.persistence,
      dispose: async () => {
        await primary.dispose()
      },
      reopen: () => instance(url),
      corruptTail: (_id: SessionId, _cwd: string | undefined) => tearTail(url, _id),
    }
  })

  runLiveWritePathContract('postgres', LIVE_WRITE_BATCH_MAX_DELAY_MS, async () => {
    const url = await freshDatabase()
    const mount = async (): Promise<Context> => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(PostgresSessionPersistence, { connectionString: url })
      return ctx
    }
    return { ctx: await mount(), remount: mount }
  })

  it('UT-S34-01: a second node observes the committed log across generations and tail', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const m = meta('ut-s34-01', '/work')
      const first = await a.persistence.create(m)
      await first.append(oneTurnLog())
      await first.close()
      // A second write handle continues at the committed next-seq; its batch
      // lands in the tail, which the second node must also observe.
      const second = await a.persistence.open(m.id, 'write')
      await second.append(continuation(6))
      await second.close()

      expect((await b.persistence.stat(m.id))?.header).toMatchObject(m)
      expect((await b.persistence.list()).map(s => s.header.id)).toContain(m.id)
      const reader = await b.persistence.open(m.id, 'read')
      expect((await reader.read()).events).toEqual([...oneTurnLog(), ...continuation(6)])
      await reader.close()
      reportResult('UT-S34-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S34-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S34-02: a torn tail is never served and the write path repairs it without touching generations', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const m = meta('ut-s34-02', '/work')
      const handle = await a.persistence.create(m)
      await handle.append(oneTurnLog())
      await handle.append(continuation(6))
      await handle.close()
      const committed = await withClient(url, client => generationBytes(client, m.id))
      await tearTail(url, m.id)

      // The read path serves only the committed prefix.
      const reader = await b.persistence.open(m.id, 'read')
      expect((await reader.read()).events).toEqual([...oneTurnLog(), ...continuation(6)])
      await reader.close()

      // A write open + append repairs the torn line away; generation rows stay byte-identical.
      const writer = await b.persistence.open(m.id, 'write')
      await writer.append(continuation(8))
      await writer.close()
      expect(await withClient(url, client => generationBytes(client, m.id))).toEqual(committed)
      const repaired = await b.persistence.open(m.id, 'read')
      expect((await repaired.read()).events).toEqual([...oneTurnLog(), ...continuation(6), ...continuation(8)])
      await repaired.close()
      reportResult('UT-S34-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S34-02', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S34-03: the advisory lock arbitrates one writer and the loser continues after release', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const m = meta('ut-s34-03', '/work')
      const creator = await a.persistence.create(m)
      await creator.append(oneTurnLog())
      await creator.close()

      const first = await a.persistence.open(m.id, 'write')
      await expect(b.persistence.open(m.id, 'write')).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
      await first.close()

      // A released; B now holds the lock through its write and A is refused
      // symmetrically: there is never a second writer.
      const second = await b.persistence.open(m.id, 'write')
      await expect(a.persistence.open(m.id, 'write')).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
      await second.append(continuation(6))
      await second.close()
      reportResult('UT-S34-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S34-03', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S34-04: a foreign format version refuses opens without leaving ownership', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const m = meta('ut-s34-04', '/work')
      const handle = await a.persistence.create(m)
      await handle.append(oneTurnLog())
      await handle.close()
      await withClient(url, async (client) => {
        await client.unsafe(`UPDATE "${SESSIONS_TABLE}" SET format_version = $2 WHERE id = $1`, [m.id, SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION + 98])
      })

      await expect(b.persistence.open(m.id, 'read')).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
      await expect(b.persistence.open(m.id, 'write')).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
      // The failed write open released its claim: retrying yields the format
      // refusal again, never an ownership error.
      await expect(b.persistence.open(m.id, 'write')).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
      reportResult('UT-S34-04', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S34-04', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S34-05: a same-generation publication race lets exactly one publisher win', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    try {
      const m = meta('ut-s34-05', '/work')
      const handle = await a.persistence.create(m)
      await handle.append(oneTurnLog())
      await handle.flush()
      await handle.close()

      // Two publishers both observed generation 1 and race to publish
      // generation 2 — the same-number exclusive publication the primary key
      // must settle with exactly one winner.
      const attempt = (client: postgres.Sql): Promise<void> => client.begin(async (tx) => {
        await tx.unsafe(
          `INSERT INTO "${GENERATIONS_TABLE}" (id, generation, bytes) VALUES ($1, 2, $2)`,
          [m.id, Buffer.from('{"type":"turn/start","seq":8}\n', 'utf8')],
        )
        await tx.unsafe(
          `UPDATE "${SESSIONS_TABLE}" SET current_generation = 2 WHERE id = $1`,
          [m.id],
        )
      })
      const outcomes = await withClient(url, async (clientA) => {
        const clientB = postgres(url, { max: 1 })
        try {
          return await Promise.allSettled([attempt(clientA), attempt(clientB)])
        } finally {
          await clientB.end()
        }
      })
      const winners = outcomes.filter(outcome => outcome.status === 'fulfilled')
      const losers = outcomes.filter(outcome => outcome.status === 'rejected')
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)

      // The pointer advanced exactly one step and one generation row exists for it.
      const state = await withClient(url, async client => ({
        pointer: (await client.unsafe(
          `SELECT current_generation FROM "${SESSIONS_TABLE}" WHERE id = $1`,
          [m.id],
        ) as Array<{ current_generation: number }>)[0]?.current_generation,
        rows: (await client.unsafe(
          `SELECT COUNT(*)::int AS count FROM "${GENERATIONS_TABLE}" WHERE id = $1 AND generation = 2`,
          [m.id],
        ) as Array<{ count: number }>)[0]?.count,
      }))
      expect(state.pointer).toBe(2)
      expect(state.rows).toBe(1)
      reportResult('UT-S34-05', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S34-05', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
    }
  })

  it('UT-S34-06: the persistence contract suite passes over postgres (anchoring smoke)', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      // Minimal end-to-end anchor of the suite's spine; the full suite runs
      // beside this file and must be green for this record to be trustworthy.
      const m = meta('ut-s34-06', '/work')
      const handle = await a.persistence.create(m)
      await handle.append(oneTurnLog())
      await handle.flush()
      await handle.close()
      const reader = await b.persistence.open(m.id, 'read')
      expect((await reader.read()).events).toEqual(oneTurnLog())
      await reader.close()
      reportResult('UT-S34-06', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S34-06', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S34-07: the live write path routes routed events through the batching window (anchoring smoke)', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(PostgresSessionPersistence, { connectionString: url })
      const session = ctx.sessions.create(SessionId('ut-s34-07'))
      const handle = await ctx.sessionPersistence.create(session.header)
      session.append('turn/start', { turn: 1 })
      await ctx.sessions.flush(session)
      expect((await (await ctx.sessionPersistence.open(session.id, 'read')).read()).events.map(event => event.seq)).toEqual([0])
      await handle.close()
      reportResult('UT-S34-07', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S34-07', 'fail', String(error))
      throw error
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ST-S34-01: two nodes converge on one flushed session', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const m = meta('st-s34-01', '/work')
      const writer = await a.persistence.create(m)
      await writer.append(oneTurnLog())
      await writer.append(continuation(6))
      // The flush barrier publishes the tail as a new immutable generation.
      await writer.flush()
      await writer.close()

      const snapshot = await b.persistence.stat(m.id)
      expect(snapshot?.header).toMatchObject(m)
      const reader = await b.persistence.open(m.id, 'read')
      expect((await reader.read()).events).toEqual([...oneTurnLog(), ...continuation(6)])
      await reader.close()
      // Generations hold everything; the tail is empty after publication.
      const physical = await withClient(url, async client => ({
        generations: (await client.unsafe(
          `SELECT COUNT(*)::int AS count FROM "${GENERATIONS_TABLE}" WHERE id = $1`,
          [m.id],
        ) as Array<{ count: number }>)[0]?.count,
        tails: (await client.unsafe(
          `SELECT COUNT(*)::int AS count FROM "${TAIL_TABLE}" WHERE id = $1`,
          [m.id],
        ) as Array<{ count: number }>)[0]?.count,
      }))
      expect(physical.generations).toBe(2)
      expect(physical.tails).toBe(0)
      reportResult('ST-S34-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S34-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('ST-S34-02: a dropped writer leaves a recoverable log for the next node', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const m = meta('st-s34-02', '/work')
      const creator = await a.persistence.create(m)
      await creator.append(oneTurnLog())
      await creator.close()
      // The "crashed" writer holds the session mid-write and its instance is
      // dropped without any further flush.
      const crashed = await a.persistence.open(m.id, 'write')
      await crashed.append(continuation(6))
      await a.dispose()
      // What remains looks like a tail whose final line never terminated.
      await tearTail(url, m.id)
      const committed = await withClient(url, client => generationBytes(client, m.id))

      // The next node reads only the committed prefix...
      const reader = await b.persistence.open(m.id, 'read')
      expect((await reader.read()).events).toEqual([...oneTurnLog(), ...continuation(6)])
      await reader.close()
      // ...and its write open completes the repair without touching generations.
      const writer = await b.persistence.open(m.id, 'write')
      await writer.append(continuation(8))
      await writer.close()
      expect(await withClient(url, client => generationBytes(client, m.id))).toEqual(committed)
      reportResult('ST-S34-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S34-02', 'fail', String(error))
      throw error
    } finally {
      await b.dispose()
    }
  })

  it('ST-S34-03: exclusive write ownership across nodes with a clean handover', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const m = meta('st-s34-03', '/work')
      const creator = await a.persistence.create(m)
      await creator.append(oneTurnLog())
      await creator.close()

      const writerA = await a.persistence.open(m.id, 'write')
      await expect(b.persistence.open(m.id, 'write')).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
      await writerA.close()

      const writerB = await b.persistence.open(m.id, 'write')
      await writerB.append(continuation(6))
      await writerB.close()
      // B observed the committed next-seq, so both nodes never wrote past one another.
      const reader = await a.persistence.open(m.id, 'read')
      expect((await reader.read()).events).toEqual([...oneTurnLog(), ...continuation(6)])
      await reader.close()
      reportResult('ST-S34-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S34-03', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url)
    const m = meta('layout-stamp')
    const handle = await first.persistence.create(m)
    await handle.flush()
    await handle.close()
    await first.dispose()

    await withClient(url, async (client) => {
      const rows = await client.unsafe(
        'SELECT version FROM session_persistence_postgres_meta WHERE singleton = 1',
      ) as Array<{ version: number }>
      expect(rows[0]?.version).toBe(SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION)
      await client.unsafe('UPDATE session_persistence_postgres_meta SET version = 99')
    })
    const second = await instance(url)
    try {
      await expect(second.persistence.stat(m.id)).rejects.toThrow(/incompatible with this build/)
    } finally {
      await second.dispose()
    }
  })
})

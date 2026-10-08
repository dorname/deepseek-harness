import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLease } from '@deepseek-ai/dsh-session-lease'
import { LEASES_TABLE, SESSION_LEASE_POSTGRES_SCHEMA_VERSION } from '../src/index.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_lease_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of ['UT-S37-01', 'UT-S37-02', 'UT-S37-03', 'UT-S37-04', 'ST-S37-01', 'ST-S37-02', 'ST-S37-03']) {
      reportResult(id, 'skip', skipReason)
    }
    reportResult('UT-S37-05', 'pass')
  }
}, 120000)

if (unavailable) {
  console.warn(`[postgres-lease.spec] SKIPPED: ${skipReason}`)
}

/** One lease service instance, as one runner node would mount it. */
async function instance(url: string): Promise<{ lease: SessionLease; dispose: () => Promise<void> }> {
  const { default: PostgresSessionLease } = await import('../src/index.ts')
  const ctx = new Context()
  const fiber = await ctx.plugin(PostgresSessionLease, { connectionString: url })
  return {
    lease: ctx.sessionLease,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('lease')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

const SESSION = SessionId('lease-session')

describe.skipIf(unavailable)('postgres session lease', () => {
  it('UT-S37-01: acquire, renew through heartbeats, release, and re-acquire', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      expect(await a.lease.acquire(SESSION, 'runner-a', 10_000)).toEqual({ status: 'acquired' })
      expect((await a.lease.ownerOf(SESSION))?.owner).toBe('runner-a')
      // A held lease refuses a second acquirer with the holder's facts.
      const refused = await b.lease.acquire(SESSION, 'runner-b', 10_000)
      expect(refused).toMatchObject({ status: 'held', holder: { owner: 'runner-a' } })
      // Renewal extends the expiry; only the owner renews.
      const before = (await a.lease.ownerOf(SESSION))?.expiresAt
      expect(await a.lease.renew(SESSION, 'runner-a', 20_000)).toBe(true)
      expect((await a.lease.ownerOf(SESSION))?.expiresAt).toBeGreaterThan(before ?? 0)
      expect(await b.lease.renew(SESSION, 'runner-b', 20_000)).toBe(false)
      // Release frees the session for an immediate re-acquire.
      expect(await a.lease.release(SESSION, 'runner-a')).toBe(true)
      expect(await a.lease.ownerOf(SESSION)).toBeUndefined()
      expect(await b.lease.acquire(SESSION, 'runner-b', 10_000)).toEqual({ status: 'acquired' })
      reportResult('UT-S37-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S37-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S37-02: concurrent acquirers get exactly one winner', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      const outcomes = await Promise.all([
        a.lease.acquire(SESSION, 'runner-a', 10_000),
        b.lease.acquire(SESSION, 'runner-b', 10_000),
      ])
      const winners = outcomes.filter(outcome => outcome.status === 'acquired')
      const losers = outcomes.filter(outcome => outcome.status === 'held')
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      expect((losers[0] as { holder: { owner: string } }).holder.owner)
        .toBe((winners[0] === outcomes[0]) ? 'runner-a' : 'runner-b')
      reportResult('UT-S37-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S37-02', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S37-03: an expired lease is taken over by exactly one of concurrent acquirers', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      expect(await a.lease.acquire(SESSION, 'runner-a', 40)).toEqual({ status: 'acquired' })
      await new Promise(resolve => setTimeout(resolve, 80))
      const outcomes = await Promise.all([
        a.lease.acquire(SESSION, 'runner-a', 10_000),
        b.lease.acquire(SESSION, 'runner-b', 10_000),
      ])
      const winners = outcomes.filter(outcome => outcome.status === 'acquired')
      expect(winners).toHaveLength(1)
      expect((await a.lease.ownerOf(SESSION))?.owner).toBe(
        winners[0] === outcomes[0] ? 'runner-a' : 'runner-b',
      )
      reportResult('UT-S37-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S37-03', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('UT-S37-04: waitLost settles for the holder when its lease is taken over', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      await a.lease.acquire(SESSION, 'runner-a', 60)
      const lost = a.lease.waitLost(SESSION, 'runner-a', 20)
      // A holder that is not the caller resolves immediately.
      await expect(a.lease.waitLost(SESSION, 'runner-b', 20)).resolves.toBe('runner-a')
      await new Promise(resolve => setTimeout(resolve, 100))
      await b.lease.acquire(SESSION, 'runner-b', 10_000)
      await expect(lost).resolves.toBe('runner-b')
      reportResult('UT-S37-04', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S37-04', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('ST-S37-01: two nodes observe mutual exclusion and handover on release', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      await a.lease.acquire(SESSION, 'runner-a', 10_000)
      const refused = await b.lease.acquire(SESSION, 'runner-b', 10_000)
      expect(refused.status).toBe('held')
      await a.lease.release(SESSION, 'runner-a')
      expect(await b.lease.acquire(SESSION, 'runner-b', 10_000)).toEqual({ status: 'acquired' })
      reportResult('ST-S37-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S37-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('ST-S37-02: simultaneous acquisition leaves exactly one holder with no window', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const nodes = await Promise.all([instance(url), instance(url), instance(url)])
    try {
      const outcomes = await Promise.all(nodes.map((node, i) =>
        node.lease.acquire(SESSION, `runner-${String.fromCharCode(97 + i)}`, 10_000)))
      expect(outcomes.filter(outcome => outcome.status === 'acquired')).toHaveLength(1)
      reportResult('ST-S37-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S37-02', 'fail', String(error))
      throw error
    } finally {
      for (const node of nodes) await node.dispose()
    }
  })

  it('ST-S37-03: a crashed holder\'s lease is taken over and its waitLost settles', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    const b = await instance(url)
    try {
      await a.lease.acquire(SESSION, 'runner-a', 60)
      const lost = a.lease.waitLost(SESSION, 'runner-a', 20)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(await b.lease.acquire(SESSION, 'runner-b', 10_000)).toEqual({ status: 'acquired' })
      await expect(lost).resolves.toBe('runner-b')
      reportResult('ST-S37-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S37-03', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url)
    await first.lease.acquire(SESSION, 'runner-a', 10_000)
    await first.dispose()

    const { default: postgres } = await import('postgres')
    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM session_lease_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]?.version).toBe(SESSION_LEASE_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE session_lease_postgres_meta SET version = 99')
    await client.end()
    const second = await instance(url)
    await expect(second.lease.ownerOf(SESSION)).rejects.toThrow(/incompatible with this build/)
    await second.dispose()
  })

  it('keeps one lease row per session in the lease table', async () => {
    const url = await freshDatabase()
    const a = await instance(url)
    try {
      for (const owner of ['runner-a', 'runner-b', 'runner-c']) {
        await a.lease.acquire(SESSION, owner, 30)
        await new Promise(resolve => setTimeout(resolve, 60))
      }
      const { default: postgres } = await import('postgres')
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(`SELECT COUNT(*)::int AS count FROM "${LEASES_TABLE}"`) as Array<{ count: number }>
      await client.end()
      expect(rows[0]?.count).toBe(1)
    } finally {
      await a.dispose()
    }
  })
})

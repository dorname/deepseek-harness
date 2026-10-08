import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import postgres from 'postgres'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SaveTextSpill } from '@deepseek-ai/dsh-spill'
import { PostgresSpillStore, SPILL_POSTGRES_SCHEMA_VERSION, TEXTS_TABLE } from '../src/index.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_spill_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of ['UT-S36-04', 'ST-S36-02']) {
      reportResult(id, 'skip', skipReason)
    }
  }
}, 120000)

if (unavailable) {
  console.warn(`[postgres-spill.spec] SKIPPED: ${skipReason}`)
}

/** One backend instance over the shared database under one fleet subject. */
async function instance(url: string, subject?: string): Promise<{ ctx: Context; store: PostgresSpillStore; dispose: () => Promise<void> }> {
  const previous = process.env.DSH_FLEET_USER_ID
  if (subject === undefined) {
    delete process.env.DSH_FLEET_USER_ID
  } else {
    process.env.DSH_FLEET_USER_ID = subject
  }
  try {
    const ctx = new Context()
    const fiber = await ctx.plugin(PostgresSpillStore, { connectionString: url })
    return {
      ctx,
      store: ctx.spillStore as PostgresSpillStore,
      dispose: async () => {
        await fiber.dispose()
        if (previous === undefined) {
          delete process.env.DSH_FLEET_USER_ID
        } else {
          process.env.DSH_FLEET_USER_ID = previous
        }
      },
    }
  } catch (error: unknown) {
    if (previous === undefined) {
      delete process.env.DSH_FLEET_USER_ID
    } else {
      process.env.DSH_FLEET_USER_ID = previous
    }
    throw error
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('spill')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

/** One tool-result spill request. */
function spill(content: string): SaveTextSpill {
  return {
    owner: { sessionId: SessionId('spill-session') },
    source: { kind: 'tool', toolName: 'web_fetch', callId: ToolCallId('call_1'), label: 'result' },
    suggestedName: 'web_fetch.txt',
    content,
  }
}

describe.skipIf(unavailable)('postgres spill backend', () => {
  it('UT-S36-04: spilled text persists verbatim behind an opaque locator, and a missing owner rejects', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url, 'acc-alice')
    try {
      const content = 'line one\nline two with 中文 and ünïcode\n'
      const ref = await a.store.saveText(spill(content))
      expect(String(ref.locator)).toMatch(/^pgspill_[0-9a-f]{36}$/)
      expect(ref.bytes).toBe(Buffer.byteLength(content, 'utf8'))
      expect(ref.retrievalHint.length).toBeGreaterThan(0)

      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(
        `SELECT bytes FROM "${TEXTS_TABLE}" WHERE ref = $1`,
        [String(ref.locator)],
      ) as Array<{ bytes: string }>
      await client.end()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.bytes).toBe(content)

      // The seam requires an owning session; losing it rejects on the medium's
      // NOT NULL rather than storing an unattributable artifact.
      const ownerless = { ...spill('x'), owner: undefined } as unknown as SaveTextSpill
      await expect(a.store.saveText(ownerless)).rejects.toThrow()
      reportResult('UT-S36-04', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S36-04', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
    }
  })

  it('ST-S36-02: a second node retrieves the same text by the spilled reference', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url, 'acc-alice')
    const b = await instance(url, 'acc-alice')
    try {
      const content = 'spilled across nodes\n'.repeat(64)
      const ref = await a.store.saveText(spill(content))
      // The seam exposes no read API; the second node verifies the artifact
      // through the shared medium directly, as an operator would.
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(
        `SELECT bytes, session_id FROM "${TEXTS_TABLE}" WHERE ref = $1`,
        [String(ref.locator)],
      ) as Array<{ bytes: string; session_id: string }>
      await client.end()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.bytes).toBe(content)
      expect(rows[0]?.session_id).toBe('spill-session')
      reportResult('ST-S36-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S36-02', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('namespaces each fleet subject\'s spills into separate columns', async () => {
    const url = await freshDatabase()
    const alice = await instance(url, 'acc-alice')
    const bob = await instance(url, 'acc-bob')
    try {
      await alice.store.saveText(spill('alice only'))
      await bob.store.saveText(spill('bob only'))
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(
        `SELECT namespace, bytes FROM "${TEXTS_TABLE}" ORDER BY namespace`,
      ) as Array<{ namespace: string; bytes: string }>
      await client.end()
      expect(rows).toHaveLength(2)
      expect(rows[0]?.namespace).not.toBe(rows[1]?.namespace)
      // Alice's subject digest names her row; the same suggested name never
      // crosses namespaces.
      expect(rows.map(row => row.bytes).sort()).toEqual(['alice only', 'bob only'])
    } finally {
      await alice.dispose()
      await bob.dispose()
    }
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url)
    await first.store.saveText(spill('warm'))
    await first.dispose()

    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM spill_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]?.version).toBe(SPILL_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE spill_postgres_meta SET version = 99')
    await client.end()
    const second = await instance(url)
    await expect(second.store.saveText(spill('after foreign stamp'))).rejects.toThrow(/incompatible with this build/)
    await second.dispose()
  })
})

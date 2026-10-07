import { afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import type { KvBackendContractHarness } from '../../storage/tests/contract.ts'
import { Config, PostgresStorageBackend, STORAGE_POSTGRES_SCHEMA_VERSION } from '../src/index.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_storage_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
})

if (unavailable) {
  // Keep the skip visible with its reason in the default reporter output.
  console.warn(`[postgres-backend.spec] SKIPPED: ${skipReason}`)
}

/** Open one fresh database and hand back a backend-plus-reopen harness over it. */
async function harness(): Promise<KvBackendContractHarness> {
  const db = freshDatabaseName('contract')
  await cluster!.createDatabase(db)
  const url = cluster!.url(db)
  return {
    backend: new PostgresStorageBackend(new Config({ connectionString: url })),
    reopen: async () => new PostgresStorageBackend(new Config({ connectionString: url })),
  }
}

describe.skipIf(unavailable)('postgres storage backend', () => {
  runKvBackendContract('postgres', harness)

  const DESCRIPTOR = {
    name: 'probe',
    version: 2,
    tables: ['alpha'],
    hasGlobal: false,
  } satisfies KvUnitDescriptor

  it('rejects a double open of one unit name', async () => {
    const { backend } = await harness()
    await backend.kv!.open(DESCRIPTOR)
    await expect(backend.kv!.open(DESCRIPTOR)).rejects.toThrow(/double-open/)
    await backend.close()
  })

  it('rejects unit or table names outside the unit-name pattern', async () => {
    const { backend } = await harness()
    await expect(backend.kv!.open({ ...DESCRIPTOR, name: 'Bad-Name' })).rejects.toThrow(/violates/)
    await expect(backend.kv!.open({ ...DESCRIPTOR, tables: ['Bad Table'] })).rejects.toThrow(/violates/)
    await backend.close()
  })

  it('maps unparsable stored JSON to malformed-medium', async () => {
    const db = freshDatabaseName('corrupt')
    await cluster!.createDatabase(db)
    const url = cluster!.url(db)
    const backend = new PostgresStorageBackend(new Config({ connectionString: url }))
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('alpha', 'k', { v: 1 })
    // Corrupt the stored value out-of-band, as another principal would.
    const client = postgres(url, { max: 1 })
    await client.unsafe('UPDATE "u_probe_alpha" SET value = $1 WHERE key = $2', ['{not json', 'k'])
    await client.end()
    await expect(unit.loadAll()).rejects.toMatchObject({ name: 'StorageError', code: 'malformed-medium' })
    await backend.close()
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const db = freshDatabaseName('meta')
    await cluster!.createDatabase(db)
    const url = cluster!.url(db)
    const first = new PostgresStorageBackend(new Config({ connectionString: url }))
    await first.kv.open(DESCRIPTOR)
    await first.close()
    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM storage_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]!.version).toBe(STORAGE_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE storage_postgres_meta SET version = 99')
    await client.end()
    const second = new PostgresStorageBackend(new Config({ connectionString: url }))
    await expect(second.kv.open(DESCRIPTOR)).rejects.toMatchObject({ name: 'StorageError', code: 'version-mismatch' })
    await second.close()
  })

  it('rejects opens after the backend closed', async () => {
    const { backend } = await harness()
    await backend.close()
    await expect(backend.kv!.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
  })
})

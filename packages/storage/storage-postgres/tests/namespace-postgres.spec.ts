import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, NAMESPACE_ENV, defineDomain, domainTable } from '../../storage-domain/src/index.ts'
import { Config, PostgresStorageBackend } from '../src/index.ts'
import { startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// ST-S35-01 precondition: a real shared Postgres medium. Unavailable binaries
// skip the suite explicitly (visible, never a silent pass).
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_storage_ns_spec', logs)
const unavailable = cluster === undefined

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    reportResult('ST-S35-01', 'skip', 'embedded-postgres binaries unavailable')
  }
})

if (unavailable) {
  console.warn(`[namespace-postgres.spec] SKIPPED: embedded-postgres binaries unavailable (${logs.slice(-2).join(' | ') || 'import failed'})`)
}

const taskSchema = z.object({ title: z.string() })
const spec = defineDomain({
  name: 'sched',
  version: 1,
  tables: { tasks: domainTable<string, z.infer<typeof taskSchema>>(taskSchema) },
})

/**
 * One simulated node: its own backend (own connection pool) plus its own
 * facility injected with `subject` — the same shape as two dsh processes
 * pointed at one shared database.
 */
async function node(database: string, subject: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new PostgresStorageBackend(new Config({ connectionString: cluster!.url(database) }))
  ctx.storage.backend.register('postgres', backend)
  const facility = new DomainFacility(ctx, { backend: 'postgres', routes: {} }, { [NAMESPACE_ENV]: subject })
  return { backend, facility }
}

function freshDb(): string {
  return `t_ns_${Math.random().toString(36).slice(2, 10)}`
}

describe.skipIf(unavailable)('per-user namespaces over one shared postgres database', () => {
  it('ST-S35-01 keeps two nodes sharing one database mutually invisible across restarts', async () => {
    const start = Date.now()
    try {
      const db = freshDb()
      await cluster!.createDatabase(db)
      const alice = await node(db, 'alice')
      const bob = await node(db, 'bob')
      const a = await alice.facility.open(spec)
      const b = await bob.facility.open(spec)
      await a.table('tasks').put('t1', { title: 'alice-task' })
      expect(b.table('tasks').get('t1')).toBeUndefined()
      await b.table('tasks').put('t1', { title: 'bob-task' })
      expect(a.table('tasks').get('t1')).toEqual({ title: 'alice-task' })
      expect(b.table('tasks').get('t1')).toEqual({ title: 'bob-task' })
      await a.close()
      await b.close()
      // A restarted node rejoins its own namespace and sees its own data.
      await alice.backend.close()
      await bob.backend.close()
      const again = await node(db, 'alice')
      const a2 = await again.facility.open(spec)
      expect(a2.table('tasks').get('t1')).toEqual({ title: 'alice-task' })
      await a2.close()
      await again.backend.close()
      reportResult('ST-S35-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('ST-S35-01', 'fail', String(error), Date.now() - start)
      throw error
    }
  })
})

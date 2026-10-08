/**
 * One staging dsh node worker for the shared-persistence deployment: a
 * separate process mounting the postgres persistence backend against the
 * shared medium, executing its node role's operations, and printing one JSON
 * result line for the deploy driver to compare across nodes. Roles:
 *
 * - `writer`: create the session, commit one turn, then (after the driver's
 *   gate) reopen it and read the events back.
 * - `reader`: open the same session read-only and print header and events.
 *
 * Run through the repo's tsx ESM hook by the deploy driver.
 */

const arg = (name) => {
  const prefix = `--${name}=`
  const found = process.argv.find(value => value.startsWith(prefix))
  if (found === undefined) throw new Error(`missing ${prefix}`)
  return found.slice(prefix.length)
}

const role = arg('role')
const sessionsUrl = arg('sessions')
const domainUrl = arg('domain')
const subject = arg('subject')

process.env.DSH_FLEET_USER_ID = subject

const { default: PostgresSessionPersistence } = await import('../../packages/session/session-persistence-postgres/src/index.ts')
const { default: Storage } = await import('../../packages/storage/storage/src/index.ts')
const { Config, PostgresStorageBackend } = await import('../../packages/storage/storage-postgres/src/index.ts')
const { DomainFacility, defineDomain, domainTable } = await import('../../packages/storage/storage-domain/src/index.ts')
const { z } = await import('zod')
const { Context } = await import('@deepseek-ai/cordis')
const { meta, oneTurnLog } = await import('../../packages/session/session-persistence/tests/contract.ts')

const ctx = new Context()
const persistenceFiber = await ctx.plugin(PostgresSessionPersistence, { connectionString: sessionsUrl })
const storageFiber = await ctx.plugin(Storage)
const backend = new PostgresStorageBackend(new Config({ connectionString: domainUrl }))
const unregister = ctx.storage.backend.register('postgres', backend)
const facility = new DomainFacility(ctx, { backend: 'postgres', routes: {} }, { DSH_FLEET_USER_ID: subject })

const header = meta('staging-shared-session')
const outcome = { role, subject, session: header.id }

if (role === 'writer') {
  const events = oneTurnLog()
  const writer = await ctx.sessionPersistence.create(header)
  await writer.append(events)
  await writer.flush()
  await writer.close()
  outcome.wroteSeqs = events.map(event => event.seq)
} else if (role === 'cross') {
  // A different subject touches only the shared domain medium: it never
  // creates the session (the sessions table carries no namespace column —
  // same-id creates are duplicates by design) and proves the domain key
  // holds its own value below.
} else if (role === 'reader') {
  const snapshot = await ctx.sessionPersistence.stat(header.id)
  if (snapshot === undefined) throw new Error(`reader never saw session ${header.id}`)
  const reader = await ctx.sessionPersistence.open(header.id, 'read')
  const events = await reader.read()
  await reader.close()
  outcome.headerId = snapshot.header.id
  outcome.readSeqs = events.events.map(event => event.seq)
}

// Domain namespace probe: each subject sees only its own value under one key.
const probeSchema = z.object({ value: z.string() })
const spec = defineDomain({ name: 'staging', version: 1, tables: { probe: domainTable(probeSchema) } })
const domain = await facility.open(spec)
await domain.table('probe').put('staging-key', { value: `from-${subject}` })
outcome.domainValue = domain.table('probe').get('staging-key')?.value
await domain.close()

unregister()
await backend.close()
await storageFiber.dispose()
await persistenceFiber.dispose()
process.stdout.write(`${JSON.stringify(outcome)}\n`)
process.exit(0)

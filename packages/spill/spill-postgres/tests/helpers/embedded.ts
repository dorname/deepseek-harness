/**
 * Embedded-Postgres test harness: a real per-suite cluster (free loopback
 * port, temp data directory, `persistent: false`) so shared-medium semantics
 * — reopen, dual connections, version stamps — are exercised against a real
 * server without root or system services. Any failure to load the binaries
 * or start the cluster resolves `undefined`; specs treat that as an explicit
 * skip (visible, never a silent pass).
 * @module
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import type EmbeddedPostgres from 'embedded-postgres'

/** One started cluster: connection URL factory plus teardown. */
export interface EmbeddedCluster {
  /** Connection string for one database of the cluster. */
  url(database?: string): string
  /** Create one additional database in the cluster (unique name per call). */
  createDatabase(name: string): Promise<void>
  /** Stop the cluster and delete its data directory. */
  stop(): Promise<void>
}

/** Reserve one free loopback port for the cluster. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => {
    resolve()
  }))
  return port
}

/**
 * Start one throwaway cluster and create the named test database.
 * @param database - Database to create for the run.
 * @param log - Sink for server logs (diagnostics on failure).
 * @returns the running cluster, or `undefined` when the platform binaries or
 * the server itself are unavailable.
 */
export async function startEmbeddedCluster(
  database = 'dsh_test',
  log: string[] = [],
): Promise<EmbeddedCluster | undefined> {
  let Embedded: typeof EmbeddedPostgres
  try {
    ({ default: Embedded } = await import('embedded-postgres'))
  } catch {
    return undefined
  }
  const port = await freePort()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spill-pg-'))
  const pg = new Embedded({
    databaseDir: dir,
    user: 'dsh',
    password: 'dshpw',
    port,
    persistent: false,
    onLog: message => log.push(message),
    onError: message => log.push(String(message)),
  })
  try {
    await pg.initialise()
    await pg.start()
    await pg.createDatabase(database)
  } catch (error) {
    log.push(String(error))
    await pg.stop().catch(() => {})
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return undefined
  }
  return {
    url: (name = database) => `postgres://dsh:dshpw@127.0.0.1:${port}/${name}`,
    createDatabase: async (name) => {
      await pg.createDatabase(name)
    },
    stop: async () => {
      await pg.stop()
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/** Fresh database name unique within one cluster run (contract suites need an empty medium per case). */
export function freshDatabaseName(label: string): string {
  return `t_${label}_${Math.random().toString(36).slice(2, 10)}`
}

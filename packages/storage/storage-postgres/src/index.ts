/**
 * PostgreSQL storage backend for the storage hub: one shared database hosts
 * every routed unit, document-per-row (`key TEXT` / `value TEXT` JSON) with
 * per-unit version stamps, so several dsh nodes can point at the same
 * database. Registers as backend `postgres`; the disposer unregisters first,
 * then closes the connection pool.
 * @module @deepseek-ai/dsh-storage-postgres
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Sql } from 'postgres'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { connectDatabase, recordTableName, unitMetaTableName } from './schema.ts'
import { PostgresKvUnit } from './unit.ts'

export { STORAGE_POSTGRES_SCHEMA_VERSION } from './schema.ts'

/** Cordis plugin name. */
export const name = 'storage-postgres'
/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration. */
export interface Config {
  /**
   * `postgres://` connection string of the shared database. The database (and
   * schema) must already exist; the backend creates its tables on connect.
   * Connect failures surface at the first use of the backend.
   */
  connectionString: string
  /**
   * Connection pool size. The KV client is low-traffic and the domain layer
   * serializes writes per unit, so the default of 1 suffices; raise it only
   * when one process serves many concurrent domain readers.
   */
  max?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  connectionString: z.string().required(),
  max: z.number().step(1).min(1).max(64).default(1),
})

/**
 * The PostgreSQL {@link StorageBackend}. Owns one connection pool and the
 * open-unit table; `kv.open` validates names, enforces the per-unit version
 * stamp in the unit's `u_<unit>___unit_meta` table, and ensures the unit's
 * record tables — each in one transaction, so two nodes opening the same unit
 * race safely (the loser sees the winner's stamp).
 */
export class PostgresStorageBackend implements StorageBackend {
  /** The key-value facet; the only shape this backend serves. */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  private readonly ready: Promise<Sql>
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<PostgresKvUnit>>()
  private closing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   */
  constructor(config: Config) {
    this.ready = connectDatabase(config.connectionString, (config as Required<Config>).max)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    /* jscpd:ignore-start -- deliberately mirrors the sqlite backend's open
       guard sequence: each backend validates its own medium's names and
       open-unit table the same way, but no shared helper should couple the
       two providers (see the domain KV storage Agent Note's reuse audit). */
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'postgres storage backend is closed'))
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
      }
    }
    // PostgreSQL truncates identifiers to 63 bytes silently, which would alias
    // distinct physical tables; fail loud instead of colliding on the medium.
    for (const physical of [unitMetaTableName(descriptor.name),
      ...descriptor.tables.map(table => recordTableName(descriptor.name, table))]) {
      if (physical.length > 63) {
        return Promise.reject(new Error(
          `kv identifier '${physical}' is ${physical.length} characters, over the PostgreSQL limit of 63; shorten the unit or table names`,
        ))
      }
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    /* jscpd:ignore-end */
    // Reserve the name synchronously so a concurrent second open of the same
    // name rejects instead of racing past the guard during the awaits below.
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<PostgresKvUnit> {
    const sql = await this.ready
    await sql.begin(async (tx) => {
      // Serialize per-unit DDL across nodes for the same reason as the shared
      // layout ensure in `connectDatabase`.
      await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', [`dsh-storage-postgres:unit:${descriptor.name}`])
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${unitMetaTableName(descriptor.name)}" (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version   INTEGER NOT NULL
      )`)
      const rows = await tx.unsafe(
        `SELECT version FROM "${unitMetaTableName(descriptor.name)}" WHERE singleton = 1`,
      ) as Array<{ version: number }>
      const stamped = rows[0]
      if (stamped === undefined) {
        // Stamp FIRST inside this transaction: the stamp and the record-table
        // DDL commit atomically, so no other node can observe a stamped unit
        // with missing tables or an unstamped one with partial tables.
      } else if (stamped.version !== descriptor.version) {
        throw new StorageError(
          'version-mismatch',
          `kv unit '${descriptor.name}' is stamped version ${stamped.version} on the medium, incompatible with descriptor version ${descriptor.version}`,
        )
      }
      for (const table of descriptor.tables) {
        // Both segments passed UNIT_NAME_RE, so the identifier is safe in DDL.
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${recordTableName(descriptor.name, table)}" (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`)
      }
      if (rows.length === 0) {
        await tx.unsafe(
          `INSERT INTO "${unitMetaTableName(descriptor.name)}" (singleton, version) VALUES (1, ${descriptor.version})`,
        )
      }
    })
    return new PostgresKvUnit(sql, descriptor, () => {
      this.units.delete(descriptor.name)
    })
  }

  /**
   * Close every open unit and release the connection pool. Idempotent;
   * concurrent and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let sql: Sql
    try {
      sql = await this.ready
    } catch {
      // The medium never connected; that failure already rejected the opener
      // and every unit call, so there is nothing left to release here.
      return
    }
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    await sql.end({ timeout: 5 })
  }
}

/**
 * Register the PostgreSQL backend as `postgres` on the storage hub. The
 * disposer unregisters the name first, then closes the backend.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config) {
  const backend = new PostgresStorageBackend(config)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('postgres', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-postgres.registerBackend')
  ctx.provide(storageBackendServiceKey('postgres'), backend)
}

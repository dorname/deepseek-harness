/**
 * Schema + connection helpers for the PostgreSQL storage backend: the physical
 * layout version, the connect/ensure sequence (shared meta and global tables),
 * and physical identifier helpers. Unit record tables and per-unit version
 * stamps are created per descriptor in `unit.ts` / `index.ts`.
 * @module @deepseek-ai/dsh-storage-postgres/schema
 */

import postgres from 'postgres'
import { StorageError } from '@deepseek-ai/dsh-storage'

/**
 * The physical layout version, stored in the shared `storage_postgres_meta`
 * table. Orthogonal to each unit's own `version` (stamped per unit in its
 * `u_<unit>___unit_meta` row). Bumped only on a breaking change to the table
 * layout; any other stamped version rejects — this unreleased format has no
 * migrations.
 */
export const STORAGE_POSTGRES_SCHEMA_VERSION = 1

/** Shared table holding every unit's global singleton (`unit` → JSON text). */
export const GLOBAL_TABLE = 'unit_globals'

/** Shared table holding the physical layout version stamp. */
export const META_TABLE = 'storage_postgres_meta'

/** Advisory-lock key serializing shared-layout DDL across nodes (see `connectDatabase`). */
const LAYOUT_LOCK_KEY = 'dsh-storage-postgres:layout'

/**
 * Physical table name for one unit table. Both segments must already be
 * validated against the storage hub's unit-name pattern, so the result is
 * safe to interpolate into DDL and statement text.
 */
export function recordTableName(unit: string, table: string): string {
  return `u_${unit}_${table}`
}

/** Physical table holding one unit's version stamp (`u_<unit>___unit_meta`). */
export function unitMetaTableName(unit: string): string {
  return `u_${unit}___unit_meta`
}

/**
 * Connect to the shared database and ensure the shared layout: the version
 * stamp in {@link META_TABLE} (a fresh database is stamped last, inside the
 * same transaction as the DDL, so an obstructed ensure leaves it unstamped
 * and a re-open retries from scratch) and the shared global table. Any other
 * non-current stamp rejects rather than being migrated in place.
 * @param connectionString - `postgres://` connection string; the database and
 * schema must exist (the backend creates tables, not databases).
 * @param max - Pool size; the KV client is low-traffic and the domain layer
 * serializes writes per unit, so a small pool suffices.
 * @returns the connected handle with the shared layout ensured.
 */
export async function connectDatabase(connectionString: string, max: number): Promise<postgres.Sql> {
  const sql = postgres(connectionString, { max })
  try {
    await sql.begin(async (tx) => {
      // Serialize layout DDL across every connection and node pointed at one
      // database: concurrent CREATE TABLE IF NOT EXISTS of the same name races
      // inside PostgreSQL's type catalog (a unique-violation crash even
      // between IF NOT EXISTS guards), and two nodes starting against an
      // empty shared database is exactly that race. Transaction-scoped, so
      // the lock releases at commit/rollback.
      await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', [LAYOUT_LOCK_KEY])
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version   INTEGER NOT NULL
      )`)
      const rows = await tx.unsafe(`SELECT version FROM "${META_TABLE}" WHERE singleton = 1`) as Array<{ version: number }>
      const stamped = rows[0]
      if (stamped !== undefined && stamped.version !== STORAGE_POSTGRES_SCHEMA_VERSION) {
        throw new StorageError(
          'version-mismatch',
          `storage database has schema version ${stamped.version}, incompatible with this build (${STORAGE_POSTGRES_SCHEMA_VERSION})`,
        )
      }
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${GLOBAL_TABLE}" (
        unit  TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`)
      if (stamped === undefined) {
        await tx.unsafe(`INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${STORAGE_POSTGRES_SCHEMA_VERSION})`)
      }
    })
    return sql
  } catch (error: unknown) {
    await sql.end({ timeout: 1 }).catch(() => {})
    throw error
  }
}

/**
 * Schema + connection helpers for the PostgreSQL session-persistence backend:
 * the physical layout version, the connect/ensure sequence, and the physical
 * table names. The `sessions` row carries the header and the committed
 * generation pointer; `session_generations` rows are immutable committed
 * generation byte ranges; `session_tail` holds the newest writes after the
 * committed generations.
 * @module @deepseek-ai/dsh-session-persistence-postgres/schema
 */

import postgres from 'postgres'

/**
 * The physical layout version, stored in the shared `session_persistence_postgres_meta`
 * table. Bumped only on a breaking change to the table layout; any other
 * stamped version rejects — this unreleased format has no migrations.
 */
export const SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION = 1

/** Per-session row: immutable header plus the committed generation pointer. */
export const SESSIONS_TABLE = 'sessions'

/** Committed generation rows; `(id, generation)` INSERT conflict is a failed exclusive publication. */
export const GENERATIONS_TABLE = 'session_generations'

/** Unmaterialized tail after the committed generations (`NULL` when none). */
export const TAIL_TABLE = 'session_tail'

/** Shared table holding the physical layout version stamp. */
export const META_TABLE = 'session_persistence_postgres_meta'

/** Advisory-lock key serializing shared-layout DDL across nodes (see `connectDatabase`). */
const LAYOUT_LOCK_KEY = 'dsh-session-persistence-postgres:layout'

/**
 * Connect to the shared database and ensure the shared layout: the version
 * stamp in {@link META_TABLE} (a fresh database is stamped last, inside the
 * same transaction as the DDL, so an obstructed ensure leaves it unstamped
 * and a re-open retries from scratch). Any other non-current stamp rejects
 * rather than being migrated in place.
 * @param connectionString - `postgres://` connection string; the database and
 *   schema must exist (the backend creates tables, not databases).
 * @param max - Pool size for read and append traffic; write handles
 *   additionally reserve one dedicated connection each for their advisory lock.
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
      if (stamped !== undefined && stamped.version !== SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION) {
        throw new Error(
          `session persistence database has schema version ${stamped.version}, incompatible with this build (${SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION})`,
        )
      }
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${SESSIONS_TABLE}" (
        id                    TEXT PRIMARY KEY,
        format_version        INTEGER NOT NULL,
        header                TEXT NOT NULL,
        current_generation    INTEGER NOT NULL DEFAULT 0,
        inherited_event_count INTEGER NOT NULL DEFAULT 0,
        created_at            BIGINT NOT NULL,
        updated_at            BIGINT NOT NULL
      )`)
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${GENERATIONS_TABLE}" (
        id         TEXT NOT NULL REFERENCES "${SESSIONS_TABLE}"(id),
        generation INTEGER NOT NULL,
        bytes      BYTEA NOT NULL,
        PRIMARY KEY (id, generation)
      )`)
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${TAIL_TABLE}" (
        id    TEXT PRIMARY KEY REFERENCES "${SESSIONS_TABLE}"(id),
        bytes TEXT NOT NULL
      )`)
      if (stamped === undefined) {
        await tx.unsafe(
          `INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION})`,
        )
      }
    })
    // Warm the pool by establishing every connection up front: postgres.js
    // creates each connection's socket lazily on first use, and write handles
    // each hold one dedicated connection for their session lock, so a later
    // lazy connect would fire exactly when the pool is busiest — and surface a
    // fresh connection's failure at mid-flight first use instead of here. A
    // fixed connection count per node is also the budget a shared database is
    // provisioned against. The concurrent round trips force one connection
    // each: a busy connection never serves the next queued query.
    await Promise.all(Array.from({ length: max }, () => sql.unsafe('SELECT 1')))
    return sql
  } catch (error: unknown) {
    await sql.end({ timeout: 1 }).catch(() => {})
    throw error
  }
}

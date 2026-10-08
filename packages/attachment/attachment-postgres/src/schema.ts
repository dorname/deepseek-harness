/**
 * Schema + connection helper for the PostgreSQL attachment backend: the
 * physical layout version and the content-addressed object table whose
 * `(namespace, sha256)` primary key namespaces every object by its owning
 * fleet subject.
 * @module @deepseek-ai/dsh-attachment-postgres/schema
 */

import postgres from 'postgres'

/**
 * The physical layout version, stored in the shared `attachment_postgres_meta`
 * table. Bumped only on a breaking change to the table layout; any other
 * stamped version rejects — this unreleased format has no migrations.
 */
export const ATTACHMENT_POSTGRES_SCHEMA_VERSION = 1

/** Content-addressed objects: one immutable row per `(namespace, digest)`. */
export const OBJECTS_TABLE = 'attachment_objects'

/** Shared table holding the physical layout version stamp. */
export const META_TABLE = 'attachment_postgres_meta'

/** Advisory-lock key serializing shared-layout DDL across nodes. */
const LAYOUT_LOCK_KEY = 'dsh-attachment-postgres:layout'

/**
 * Connect to the shared database and ensure the shared layout: the version
 * stamp (stamped last, inside the same transaction as the DDL, so an
 * obstructed ensure leaves it unstamped and a re-open retries from scratch)
 * and the object table. Any other non-current stamp rejects rather than being
 * migrated in place.
 * @param connectionString - `postgres://` connection string; the database and
 *   schema must exist (the backend creates tables, not databases).
 * @param max - Pool size for object writes and reads.
 * @returns the connected handle with the shared layout ensured.
 */
export async function connectDatabase(connectionString: string, max: number): Promise<postgres.Sql> {
  const sql = postgres(connectionString, { max })
  try {
    await sql.begin(async (tx) => {
      // Serialize layout DDL across every connection and node pointed at one
      // database: concurrent CREATE TABLE IF NOT EXISTS of the same name races
      // inside PostgreSQL's type catalog even between IF NOT EXISTS guards.
      await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', [LAYOUT_LOCK_KEY])
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version   INTEGER NOT NULL
      )`)
      const rows = await tx.unsafe(`SELECT version FROM "${META_TABLE}" WHERE singleton = 1`) as Array<{ version: number }>
      const stamped = rows[0]
      if (stamped !== undefined && stamped.version !== ATTACHMENT_POSTGRES_SCHEMA_VERSION) {
        throw new Error(
          `attachment database has schema version ${stamped.version}, incompatible with this build (${ATTACHMENT_POSTGRES_SCHEMA_VERSION})`,
        )
      }
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${OBJECTS_TABLE}" (
        namespace  TEXT NOT NULL,
        sha256     TEXT NOT NULL,
        media_type TEXT NOT NULL,
        bytes      BYTEA NOT NULL,
        size       BIGINT NOT NULL,
        width      INTEGER NOT NULL,
        height     INTEGER NOT NULL,
        name       TEXT,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (namespace, sha256)
      )`)
      if (stamped === undefined) {
        await tx.unsafe(
          `INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${ATTACHMENT_POSTGRES_SCHEMA_VERSION})`,
        )
      }
    })
    return sql
  } catch (error: unknown) {
    await sql.end({ timeout: 1 }).catch(() => {})
    throw error
  }
}

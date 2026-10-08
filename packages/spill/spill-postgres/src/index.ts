/**
 * PostgreSQL spill backend. It persists each spilled text as one row in a
 * shared `spill_texts` table keyed by a backend-minted opaque reference, so
 * several dsh nodes point at the same medium and every fleet subject's spills
 * stay in their own namespace column. The seam is deliberately minimal:
 * `saveText` and nothing else — retention, replacement, and retrieval remain
 * their owning packages' concerns.
 * @module @deepseek-ai/dsh-spill-postgres
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import postgres from 'postgres'
import type postgresType from 'postgres'
import { createHash, randomBytes } from 'node:crypto'
import { SpillStore, SpillLocator } from '@deepseek-ai/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'

/**
 * The physical layout version, stored in the shared `spill_postgres_meta`
 * table. Bumped only on a breaking change to the table layout; any other
 * stamped version rejects — this unreleased format has no migrations.
 */
export const SPILL_POSTGRES_SCHEMA_VERSION = 1

/** Spilled texts: one row per opaque reference, namespaced by fleet subject. */
export const TEXTS_TABLE = 'spill_texts'

/** Shared table holding the physical layout version stamp. */
const META_TABLE = 'spill_postgres_meta'

/** Advisory-lock key serializing shared-layout DDL across nodes. */
const LAYOUT_LOCK_KEY = 'dsh-spill-postgres:layout'

/** The environment variable carrying the fleet subject (see the fleet manager). */
const NAMESPACE_ENV = 'DSH_FLEET_USER_ID'

/** The namespace column value for a fleet subject's digest, or the default empty namespace. */
function namespaceColumn(env: NodeJS.ProcessEnv): string {
  const subject = env[NAMESPACE_ENV]?.trim()
  if (subject === undefined || subject.length === 0) return ''
  return `u${createHash('sha256').update(subject, 'utf8').digest('hex').slice(0, 16)}`
}

/** Plugin configuration for the PostgreSQL spill backend. */
export interface Config {
  /**
   * `postgres://` connection string of the shared database. The database (and
   * schema) must already exist; the backend creates its tables on connect.
   * Connect failures surface at the first use of the backend.
   */
  connectionString: string
  /** Connection pool size for text writes. */
  max?: number
}

/**
 * The PostgreSQL spill backend. Load as a plugin; it registers as
 * `ctx.spillStore`. The locator is a backend-minted opaque reference carrying
 * no storage coordinates; the fleet subject injected through
 * `DSH_FLEET_USER_ID` derives the namespace column, so two nodes with
 * different subjects never see each other's spills.
 */
export class PostgresSpillStore extends SpillStore {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(2),
  })

  override readonly name = 'spill-postgres'

  private readonly ready: Promise<postgresType.Sql>
  private closing: Promise<void> | undefined
  private readonly namespace: string

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.ready = this.connect(config.connectionString, config.max ?? 2)
    // Mark the rejection handled: `saveText` re-awaits `ready`, so an open
    // failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    ctx.effect(() => async () => {
      this.closing ??= (async () => {
        try {
          const sql = await this.ready
          await sql.end({ timeout: 5 })
        } catch {
          // The pool never connected; that failure already rejected the first
          // caller, and there is nothing left to release here.
        }
      })()
      await this.closing
    }, 'spill-postgres connection pool')
    this.namespace = namespaceColumn(process.env)
  }

  private async connect(connectionString: string, max: number): Promise<postgresType.Sql> {
    const sql = postgres(connectionString, { max })
    try {
      await sql.begin(async (tx) => {
        // Serialize layout DDL across every connection and node pointed at
        // one database: concurrent CREATE TABLE IF NOT EXISTS of the same
        // name races inside PostgreSQL's type catalog even between IF NOT
        // EXISTS guards.
        await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', [LAYOUT_LOCK_KEY])
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version   INTEGER NOT NULL
        )`)
        const rows = await tx.unsafe(`SELECT version FROM "${META_TABLE}" WHERE singleton = 1`) as Array<{ version: number }>
        const stamped = rows[0]
        if (stamped !== undefined && stamped.version !== SPILL_POSTGRES_SCHEMA_VERSION) {
          throw new Error(
            `spill database has schema version ${stamped.version}, incompatible with this build (${SPILL_POSTGRES_SCHEMA_VERSION})`,
          )
        }
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${TEXTS_TABLE}" (
          namespace  TEXT NOT NULL,
          ref        TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          bytes      TEXT NOT NULL,
          created_at BIGINT NOT NULL
        )`)
        if (stamped === undefined) {
          await tx.unsafe(
            `INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${SPILL_POSTGRES_SCHEMA_VERSION})`,
          )
        }
      })
      return sql
    } catch (error: unknown) {
      await sql.end({ timeout: 1 }).catch(() => {})
      throw error
    }
  }

  override async saveText(input: SaveTextSpill): Promise<SpillRef> {
    const sql = await this.ready
    const bytes = Buffer.from(input.content, 'utf8')
    const ref = `pgspill_${randomBytes(18).toString('hex')}`
    await sql.unsafe(`
      INSERT INTO "${TEXTS_TABLE}" (namespace, ref, session_id, bytes, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [this.namespace, ref, input.owner.sessionId, bytes.toString('utf8'), Date.now()])
    return {
      locator: SpillLocator(ref),
      bytes: bytes.byteLength,
      retrievalHint: 'This artifact is spilled to the shared database; ask the operator to retrieve it from the spill store by its reference.',
    }
  }
}

export default PostgresSpillStore

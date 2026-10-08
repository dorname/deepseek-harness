/**
 * PostgreSQL session-lease provider: one `session_leases` row per session,
 * where acquiring a free or expired lease and refusing a live one is a
 * single atomic `INSERT … ON CONFLICT DO UPDATE … WHERE` statement — so
 * concurrent acquirers and expired-lease takeovers each get exactly one
 * winner, and `renew`/`release` are owner-checked single statements.
 * `waitLost` polls `ownerOf`; its interval is the loss-latency budget.
 * @module @deepseek-ai/dsh-session-lease-postgres
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import postgres from 'postgres'
import type postgresType from 'postgres'
import { SessionLease } from '@deepseek-ai/dsh-session-lease'
import type { AcquireOutcome, LeaseFacts } from '@deepseek-ai/dsh-session-lease'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** The lease table this provider owns. */
export const LEASES_TABLE = 'session_leases'

/** The physical layout version stamped in `session_lease_postgres_meta`. */
export const SESSION_LEASE_POSTGRES_SCHEMA_VERSION = 1

const META_TABLE = 'session_lease_postgres_meta'
const LAYOUT_LOCK_KEY = 'dsh-session-lease-postgres:layout'

/** Plugin configuration. */
export interface Config {
  /**
   * `postgres://` connection string of the shared lease database. The
   * database (and schema) must already exist; the provider creates its
   * tables on connect. Connect failures surface at the first use.
   */
  connectionString: string
  /** Connection pool size; lease traffic is one-statement and low-volume. */
  max?: number
}

/** One row of the lease table. */
interface LeaseRow {
  owner_node: string
  lease_expires_at: string
}

/**
 * The PostgreSQL session-lease provider. Load as a plugin; it registers as
 * `ctx.sessionLease`.
 */
export class PostgresSessionLease extends SessionLease {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(2),
  })

  override readonly name = 'session-lease-postgres'

  private readonly ready: Promise<postgresType.Sql>
  private closing: Promise<void> | undefined

  /** End the connection pool explicitly; the context effect also closes it. */
  async closePool(): Promise<void> {
    this.closing ??= (async () => {
      try {
        const sql = await this.ready
        await sql.end({ timeout: 5 })
      } catch {
        // The pool never connected; that failure already rejected the first
        // caller, and there is nothing left to release here.
      }
      console.error('['+this.name+'.closePool] done')
    })()
    await this.closing
  }

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.ready = this.connect(config.connectionString, config.max ?? 2)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    ctx.effect(() => async () => {
      await this.closePool()
    }, 'session-lease-postgres connection pool')
  }

  private async connect(connectionString: string, max: number): Promise<postgresType.Sql> {
    const sql = postgres(connectionString, { max })
    try {
      await sql.begin(async (tx) => {
        // Serialize layout DDL across every node: concurrent CREATE TABLE IF
        // NOT EXISTS of one name races inside PostgreSQL's type catalog.
        await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', [LAYOUT_LOCK_KEY])
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version   INTEGER NOT NULL
        )`)
        const rows = await tx.unsafe(`SELECT version FROM "${META_TABLE}" WHERE singleton = 1`) as Array<{ version: number }>
        const stamped = rows[0]
        if (stamped !== undefined && stamped.version !== SESSION_LEASE_POSTGRES_SCHEMA_VERSION) {
          throw new Error(
            `session lease database has schema version ${stamped.version}, incompatible with this build (${SESSION_LEASE_POSTGRES_SCHEMA_VERSION})`,
          )
        }
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${LEASES_TABLE}" (
          session_id       TEXT PRIMARY KEY,
          owner_node       TEXT NOT NULL,
          lease_expires_at BIGINT NOT NULL,
          acquired_at      BIGINT NOT NULL
        )`)
        if (stamped === undefined) {
          await tx.unsafe(`INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${SESSION_LEASE_POSTGRES_SCHEMA_VERSION})`)
        }
      })
      return sql
    } catch (error: unknown) {
      await sql.end({ timeout: 1 }).catch(() => {})
      throw error
    }
  }

  override async acquire(id: SessionId, owner: string, ttlMs: number): Promise<AcquireOutcome> {
    const sql = await this.ready
    const now = Date.now()
    const updated = await sql.unsafe(
      `INSERT INTO "${LEASES_TABLE}" (session_id, owner_node, lease_expires_at, acquired_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE
         SET owner_node = $2, lease_expires_at = $3, acquired_at = $4
         WHERE "${LEASES_TABLE}".owner_node = $2 OR "${LEASES_TABLE}".lease_expires_at < $5
       RETURNING 1`,
      [id, owner, now + ttlMs, now, now],
    )
    if (updated.length > 0) return { status: 'acquired' }
    const rows = await sql.unsafe(
      `SELECT owner_node, lease_expires_at FROM "${LEASES_TABLE}" WHERE session_id = $1`,
      [id],
    ) as Array<LeaseRow>
    const row = rows[0]
    if (row === undefined) {
      // The lease row vanished between the conflicting update and this read
      // (the holder released in that window): one plain insert settles it.
      const inserted = await sql.unsafe(
        `INSERT INTO "${LEASES_TABLE}" (session_id, owner_node, lease_expires_at, acquired_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id) DO NOTHING
         RETURNING 1`,
        [id, owner, now + ttlMs, now],
      )
      return inserted.length > 0
        ? { status: 'acquired' }
        : { status: 'held', holder: { owner: owner, expiresAt: now } }
    }
    return { status: 'held', holder: { owner: row.owner_node, expiresAt: Number(row.lease_expires_at) } }
  }

  override async renew(id: SessionId, owner: string, ttlMs: number): Promise<boolean> {
    const sql = await this.ready
    const updated = await sql.unsafe(
      `UPDATE "${LEASES_TABLE}" SET lease_expires_at = $3 WHERE session_id = $1 AND owner_node = $2 RETURNING 1`,
      [id, owner, Date.now() + ttlMs],
    )
    return updated.length > 0
  }

  override async release(id: SessionId, owner: string): Promise<boolean> {
    const sql = await this.ready
    const deleted = await sql.unsafe(
      `DELETE FROM "${LEASES_TABLE}" WHERE session_id = $1 AND owner_node = $2 RETURNING 1`,
      [id, owner],
    )
    return deleted.length > 0
  }

  override async ownerOf(id: SessionId): Promise<LeaseFacts | undefined> {
    const sql = await this.ready
    const rows = await sql.unsafe(
      `SELECT owner_node, lease_expires_at FROM "${LEASES_TABLE}" WHERE session_id = $1`,
      [id],
    ) as Array<LeaseRow>
    const row = rows[0]
    return row === undefined ? undefined : { owner: row.owner_node, expiresAt: Number(row.lease_expires_at) }
  }

  override async waitLost(id: SessionId, owner: string, pollMs = 200, signal?: AbortSignal): Promise<string> {
    for (;;) {
      signal?.throwIfAborted()
      const facts = await this.ownerOf(id)
      if (facts === undefined) return 'released'
      if (facts.owner !== owner) return facts.owner
      await sleep(pollMs, signal)
    }
  }
}

/** Abortable sleep between waitLost polls. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, ms)
    const stop = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('waitLost aborted', { cause: signal?.reason }))
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        clearTimeout(timer)
        stop()
        return
      }
      signal.addEventListener('abort', stop, { once: true })
    }
  })
}

export default PostgresSessionLease

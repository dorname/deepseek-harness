/**
 * PostgreSQL stream-relay provider: one `stream_relay_log` row per published
 * record, its per-session sequence number assigned atomically by a single
 * CTE insert. `NOTIFY relay_wake` (payload = session id) wakes subscribers;
 * the notification carries no records — every wake and every poll tick
 * replays from the subscriber's cursor, so a lost wake, a late join, and a
 * reconnect all catch up without gaps or duplicates.
 * @module @deepseek-ai/dsh-stream-relay-postgres
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import postgres from 'postgres'
import type postgresType from 'postgres'
import { StreamRelay } from '@deepseek-ai/dsh-stream-relay'
import type { RelayRecord, RelayRecordHandler, RelayRecordKind } from '@deepseek-ai/dsh-stream-relay'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** The relay log table this provider owns. */
export const RELAY_LOG_TABLE = 'stream_relay_log'

/** The wake channel; its payload carries only the session id. */
export const RELAY_WAKE_CHANNEL = 'relay_wake'

/** The physical layout version stamped in `stream_relay_postgres_meta`. */
export const STREAM_RELAY_POSTGRES_SCHEMA_VERSION = 1

const META_TABLE = 'stream_relay_postgres_meta'
const LAYOUT_LOCK_KEY = 'dsh-stream-relay-postgres:layout'

/** Plugin configuration. */
export interface Config {
  /**
   * `postgres://` connection string of the shared relay database. The
   * database (and schema) must already exist; the provider creates its
   * tables on connect. Connect failures surface at the first use.
   */
  connectionString: string
  /** Connection pool size for publishes and cursor reads. */
  max?: number
}

/** One row of the relay log. */
interface RelayRow {
  seq: string
  kind: RelayRecordKind
  payload: unknown
}

/**
 * The PostgreSQL stream-relay provider. Load as a plugin; it registers as
 * `ctx.streamRelay`. Subscribers share the pool's dedicated LISTEN
 * connection managed by postgres.js.
 */
export class PostgresStreamRelay extends StreamRelay {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(4),
  })

  override readonly name = 'stream-relay-postgres'

  private readonly ready: Promise<postgresType.Sql>
  private closing: Promise<void> | undefined
  /** One shared LISTEN subscription on its own client; per-session subscribers multiplex over it. */
  private listening: Promise<postgresType.ListenMeta> | undefined
  /** The dedicated LISTEN client; it ends with the subscription, not with the pool. */
  private listenClient: postgresType.Sql | undefined
  /** Every subscription's LISTEN handle, so one subscriber's unsubscribe only drops its own. */
  private readonly subscribers = new Set<{ stopped: boolean }>()

  /**
   * Drop the shared LISTEN subscription and end the connection pool. The
   * context effect calls this; an explicit call lets a driver sequence the
   * relay pool before other providers stop theirs — a LISTEN handle keeps
   * `sql.end` pending while it remains attached.
   */
  async closePool(): Promise<void> {
    this.closing ??= (async () => {
      this.listening = undefined
      // The LISTEN handle lives on a dedicated client; ending that client
      // releases the listen connection without waiting on the pool's own
      // statement traffic. Unsubscribe first so no catch-up runs against a
      // closing pool.
      this.subscribers.forEach((subscriber) => {
        subscriber.stopped = true
      })
      this.subscribers.clear()
      if (this.listenClient !== undefined) {
        const client = this.listenClient
        this.listenClient = undefined
        await client.end({ timeout: 5 }).catch(() => undefined)
      }
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
    this.ready = this.connect(config.connectionString, config.max ?? 4)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    ctx.effect(() => async () => {
      await this.closePool()
    }, 'stream-relay-postgres connection pool')
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
        if (stamped !== undefined && stamped.version !== STREAM_RELAY_POSTGRES_SCHEMA_VERSION) {
          throw new Error(
            `stream relay database has schema version ${stamped.version}, incompatible with this build (${STREAM_RELAY_POSTGRES_SCHEMA_VERSION})`,
          )
        }
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${RELAY_LOG_TABLE}" (
          session_id TEXT NOT NULL,
          seq        BIGINT NOT NULL,
          kind       TEXT NOT NULL,
          payload    TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (session_id, seq)
        )`)
        if (stamped === undefined) {
          await tx.unsafe(`INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${STREAM_RELAY_POSTGRES_SCHEMA_VERSION})`)
        }
      })
      return sql
    } catch (error: unknown) {
      await sql.end({ timeout: 1 }).catch(() => {})
      throw error
    }
  }

  override async publish(id: SessionId, kind: RelayRecordKind, payload: JsonValue): Promise<number> {
    const sql = await this.ready
    const rows = await sql.unsafe(
      `WITH next AS (
         SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM "${RELAY_LOG_TABLE}" WHERE session_id = $1
       )
       INSERT INTO "${RELAY_LOG_TABLE}" (session_id, seq, kind, payload, created_at)
       SELECT $1, next.s, $2, $3, $4 FROM next
       RETURNING seq`,
      [id, kind, JSON.stringify(payload), Date.now()],
    ) as Array<{ seq: string }>
    const seq = Number(rows[0]?.seq)
    // Wake subscribers; the payload names only the session (NOTIFY payloads
    // cap at 8000 bytes — records travel through the table, not the notice).
    await sql.notify(RELAY_WAKE_CHANNEL, id)
    return seq
  }

  override async read(id: SessionId, afterSeq: number): Promise<readonly RelayRecord[]> {
    const sql = await this.ready
    const rows = await sql.unsafe(
      `SELECT seq, kind, payload FROM "${RELAY_LOG_TABLE}" WHERE session_id = $1 AND seq > $2 ORDER BY seq`,
      [id, afterSeq],
    ) as Array<RelayRow>
    return rows.map(row => ({
      seq: Number(row.seq),
      kind: row.kind,
      // The log stores the serialized record; a read returns the parsed body.
      payload: JSON.parse(row.payload as string) as JsonValue,
    }))
  }

  override async maxSeq(id: SessionId): Promise<number> {
    const sql = await this.ready
    const rows = await sql.unsafe(
      `SELECT COALESCE(MAX(seq), 0) AS s FROM "${RELAY_LOG_TABLE}" WHERE session_id = $1`,
      [id],
    ) as Array<{ s: string }>
    return Number(rows[0]?.s)
  }

  override async subscribe(
    id: SessionId,
    afterSeq: number,
    onRecord: RelayRecordHandler,
    pollMs = 0,
    signal?: AbortSignal,
  ): Promise<() => void> {
    await this.ready
    let cursor = afterSeq
    let stopped = false
    let draining: Promise<void> = Promise.resolve()

    const catchUp = async (): Promise<void> => {
      for (;;) {
        const batch = await this.read(id, cursor)
        if (batch.length === 0) return
        for (const record of batch) {
          if (stopped) return
          if (record.seq !== cursor + 1) {
            // A gap means records were published before our cursor read —
            // impossible under the gapless per-session sequence; refuse loud.
            throw new Error(`relay gap for session "${id}": expected ${String(cursor + 1)}, got ${String(record.seq)}`)
          }
          cursor = record.seq
          onRecord(record)
        }
      }
    }
    const scheduleCatchUp = (): void => {
      draining = draining.then(catchUp).catch((error: unknown) => {
        if (!stopped) {
          stopped = true
          throw error
        }
      })
    }

    // Shared LISTEN multiplexed across this provider's subscribers; the wake
    // payload names the session, so unrelated wakes cost one cursor read.
    // ListenRequest is thenable and carries `unlisten` after it resolves.
    if (this.listening === undefined) {
      this.listenClient = postgres(this.config.connectionString, { max: 1 })
      this.listening = Promise.resolve(
        this.listenClient.listen(RELAY_WAKE_CHANNEL, (payload: string) => {
          if (payload === id && !stopped) scheduleCatchUp()
        }),
      )
    }
    const listener = await this.listening
    const handle = { stopped }
    this.subscribers.add(handle)
    // Late join replays immediately; the poll tick is the lost-wake fallback.
    scheduleCatchUp()
    const poll = pollMs > 0
      ? setInterval(() => {
        if (!stopped) scheduleCatchUp()
      }, pollMs)
      : undefined

    const unsubscribe = (): void => {
      if (stopped) return
      stopped = true
      if (poll !== undefined) clearInterval(poll)
      signal?.removeEventListener('abort', unsubscribe)
      this.subscribers.delete(handle)
      // Only the LAST subscriber's unsubscribe releases the shared LISTEN
      // handle; an earlier one must not end a wake still in use.
      if (this.subscribers.size === 0) void listener.unlisten()
    }
    signal?.addEventListener('abort', unsubscribe, { once: true })
    return unsubscribe
  }
}

export default PostgresStreamRelay

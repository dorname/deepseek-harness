/**
 * Stateless webhook ingress. Entry replicas only verify the signature and
 * queue the event: one shared `webhook_events` table (the dedupe key is the
 * primary key, so replicated or retried deliveries collapse to one row)
 * plus a `NOTIFY` wake, then an immediate acceptance response. The consumer
 * loop takes pending events with `FOR UPDATE SKIP LOCKED`, creates the
 * Workspace Session through the injected consume callback, and marks the
 * event done in the same transaction — a crash rolls the take back and the
 * next round redelivers, so no event is lost and no session is duplicated.
 * @module @deepseek-ai/dsh-webhook-ingress
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import postgres from 'postgres'
import type postgresType from 'postgres'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** The events table this provider owns. */
export const WEBHOOK_EVENTS_TABLE = 'webhook_events'

/** The physical layout version stamped in `webhook_ingress_postgres_meta`. */
export const WEBHOOK_INGRESS_POSTGRES_SCHEMA_VERSION = 1

const META_TABLE = 'webhook_ingress_postgres_meta'
const LAYOUT_LOCK_KEY = 'dsh-webhook-ingress:layout'

/**
 * Verify one HMAC-SHA256 event signature (`sha256=<hex>`) against the raw
 * body and the deployment secret in constant time.
 * @param rawBody - the exact request body bytes.
 * @param signatureHeader - the sender's signature header value.
 * @param secret - the deployment's webhook secret.
 * @returns whether the signature verifies.
 */
export function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = signatureHeader.startsWith('sha256=') ? signatureHeader.slice('sha256='.length) : signatureHeader
  const provided = Buffer.from(expected, 'utf8')
  const computed = Buffer.from(createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'), 'utf8')
  return provided.length === computed.length && timingSafeEqual(provided, computed)
}

/** Plugin configuration. */
export interface Config {
  /**
   * `postgres://` connection string of the shared events database. The
   * database (and schema) must already exist; the provider creates its
   * tables on connect. Connect failures surface at the first use.
   */
  connectionString: string
  /** Connection pool size for event writes and consumption. */
  max?: number
  /** Fallback polling interval while waiting for pending events. */
  pollMs?: number
  /**
   * Consumer form: loading auto-starts the consume loop and fiber disposal
   * (SIGTERM on every orchestrator) aborts it after the in-flight round.
   */
  consumer?: boolean
  /**
   * Consume one pending event: create the Workspace Session from the event
   * payload and hand its id to the execution pool. The dispatch guarantees
   * at-least-once invocation — a throw rolls the take back and the next
   * round recreates.
   */
  consume: (dedupeKey: string, payload: JsonValue) => Promise<void>
}

/**
 * The PostgreSQL webhook ingress. Entry replicas call
 * {@link WebhookIngress.enqueue} (after signature verification); consumer
 * nodes call {@link WebhookIngress.runConsumer}. Load as a plugin to
 * register the connection-pool teardown effect.
 */
export class WebhookIngress {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(2),
    pollMs: z.number().step(1).min(20).max(60_000).default(250),
    consumer: z.boolean().default(false),
    consume: z.any().required(),
  })

  readonly name = 'webhook-ingress'

  private readonly ready: Promise<postgresType.Sql>
  private closing: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    public config: Config,
  ) {
    this.ready = this.connect(config.connectionString, config.max ?? 2)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    ctx.effect(() => async () => {
      await this.closePool()
    }, 'webhook-ingress connection pool')
    // Consumer form: loading auto-starts the consume loop; disposal aborts it
    // after the in-flight round (SIGTERM on every orchestrator).
    if (config.consumer === true) {
      const controller = new AbortController()
      this.loopDone = this.runConsumer(controller.signal)
      ctx.effect(() => async () => {
        controller.abort()
        await this.loopDone
      }, 'webhook-ingress consumer loop')
    }
  }

  /** The consumer loop's full settlement; the lifecycle disposer waits for it. */
  private loopDone: Promise<void> = Promise.resolve()

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
        if (stamped !== undefined && stamped.version !== WEBHOOK_INGRESS_POSTGRES_SCHEMA_VERSION) {
          throw new Error(
            `webhook ingress database has schema version ${stamped.version}, incompatible with this build (${WEBHOOK_INGRESS_POSTGRES_SCHEMA_VERSION})`,
          )
        }
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${WEBHOOK_EVENTS_TABLE}" (
          dedupe_key  TEXT PRIMARY KEY,
          payload     TEXT NOT NULL,
          state       TEXT NOT NULL DEFAULT 'pending',
          created_at  BIGINT NOT NULL,
          consumed_at BIGINT
        )`)
        if (stamped === undefined) {
          await tx.unsafe(`INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${WEBHOOK_INGRESS_POSTGRES_SCHEMA_VERSION})`)
        }
      })
      return sql
    } catch (error: unknown) {
      await sql.end({ timeout: 1 }).catch(() => {})
      throw error
    }
  }

  /**
   * Queue one verified event. The dedupe key is the table's primary key, so
   * replicated entries across entry replicas and sender retries collapse to
   * one row; the wake notifies consumer nodes either way.
   * @param dedupeKey - the event's idempotency key (e.g. delivery id).
   * @param payload - the event's session-creation payload as JSON.
   * @returns whether this call inserted the row (`false` = already queued).
   */
  async enqueue(dedupeKey: string, payload: JsonValue): Promise<boolean> {
    const sql = await this.ready
    const inserted = await sql.unsafe(`
      INSERT INTO "${WEBHOOK_EVENTS_TABLE}" (dedupe_key, payload, state, created_at)
      VALUES ($1, $2, 'pending', $3)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING 1
    `, [dedupeKey, JSON.stringify(payload), Date.now()])
    await sql.notify('webhook_ingress_wake', dedupeKey)
    return inserted.length > 0
  }

  /**
   * Run the consumer loop until the signal aborts. Each round is one
   * transaction: take the oldest pending event under `FOR UPDATE SKIP
   * LOCKED` (the row lock is the exactly-once take), run the injected
   * consume callback (create the Workspace Session, hand the id to the
   * execution pool), mark done, commit. A consume throw rolls the round
   * back — the event stays pending and the next round recreates
   * (at-least-once; session creation must be idempotent by dedupe key).
   * @param signal - the consumer's lifecycle; the loop exits on abort.
   */
  async runConsumer(signal: AbortSignal): Promise<void> {
    const consume = this.config.consume
    const pollMs = this.config.pollMs ?? 250
    const sql = await this.ready
    while (!signal.aborted) {
      try {
        const round = await sql.begin(async (tx) => {
          const rows = await tx.unsafe(`
            SELECT dedupe_key, payload FROM "${WEBHOOK_EVENTS_TABLE}"
            WHERE state = 'pending'
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED LIMIT 1
          `) as Array<{ dedupe_key: string; payload: string }>
          const row = rows[0]
          if (row === undefined) return false
          await consume(row.dedupe_key, JSON.parse(row.payload) as JsonValue)
          await tx.unsafe(
            `UPDATE "${WEBHOOK_EVENTS_TABLE}" SET state = 'done', consumed_at = $2 WHERE dedupe_key = $1`,
            [row.dedupe_key, Date.now()],
          )
          return true
        })
        if (!round) await this.wait(pollMs, signal)
      } catch (error: unknown) {
        // The round rolled back: the event stays pending and is recreated
        // next round.
        this.ctx.logger.warn(`webhook-ingress: consume round failed (event stays pending): ${String(error)}`)
        await this.wait(pollMs, signal)
      }
    }
  }

  /** Wait one poll interval. */
  private async wait(pollMs: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollMs)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }

  /**
   * End the connection pool explicitly; the context effect also closes it.
   */
  async closePool(): Promise<void> {
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
  }
}

export default WebhookIngress

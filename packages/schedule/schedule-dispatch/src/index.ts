/**
 * Shared schedule dispatch: due rows live in one shared `schedule_due`
 * table (one row per task, `next_due_at` advancing monotonically), and
 * runner nodes run the dispatch loop — take the newest due row with
 * `FOR UPDATE SKIP LOCKED`, acquire the session lease, deliver, and advance
 * next-due, all inside one transaction whose row lock is the exactly-once
 * take guarantee. A crash before commit rolls the row lock back, so the row
 * is delivered by the next round — reminders are never lost. A recurring
 * row's advancement skips whole missed periods and lands on the first
 * strictly future instant: only the latest missed occurrence is delivered.
 * @module @deepseek-ai/dsh-schedule-dispatch
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import postgres from 'postgres'
import type postgresType from 'postgres'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLease } from '@deepseek-ai/dsh-session-lease'

/** The due-rows table this provider owns. */
export const SCHEDULE_DUE_TABLE = 'schedule_due'

/** The physical layout version stamped in `schedule_dispatch_postgres_meta`. */
export const SCHEDULE_DISPATCH_POSTGRES_SCHEMA_VERSION = 1

const META_TABLE = 'schedule_dispatch_postgres_meta'
const LAYOUT_LOCK_KEY = 'dsh-schedule-dispatch:layout'

/** The recurrence encoding stored in the `recurrence` column. */
export type Recurrence = 'once' | `interval:${number}`

/** One scheduled task row as stored and delivered. */
export interface ScheduleTask {
  readonly taskId: string
  readonly sessionId: string
  readonly title: string
  readonly prompt: string
  readonly recurrence: Recurrence
  readonly nextDueAt: number
}

/** Plugin configuration. */
export interface Config {
  /**
   * `postgres://` connection string of the shared schedule database. The
   * database (and schema) must already exist; the provider creates its
   * tables on connect. Connect failures surface at the first use.
   */
  connectionString: string
  /** Connection pool size; due-row traffic is one-statement and low-volume. */
  max?: number
  /** This runner node's lease identity; required to run the loop. */
  nodeId?: string
  /** Lease lifetime in milliseconds for the delivery window. */
  leaseTtlMs?: number
  /** Fallback polling interval while waiting for due work. */
  pollMs?: number
  /**
   * Deliver one due task: resume the session and append the reminder. The
   * dispatch guarantees at-least-once invocation per occurrence — a throw
   * rolls the take back and the next round redelivers.
   */
  deliver: (task: ScheduleTask) => Promise<void>
}

/** One due row as read from the table. */
interface DueRow {
  task_id: string
  session_id: string
  title: string
  prompt: string
  recurrence: Recurrence
  next_due_at: string
}

/**
 * The PostgreSQL shared-schedule dispatch. Entry points upsert or cancel
 * task rows; runner nodes call {@link PostgresScheduleDispatch.runLoop}.
 * Load as a plugin to register the connection-pool teardown effect.
 */
export class PostgresScheduleDispatch {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(2),
    leaseTtlMs: z.number().step(1).min(50).max(300_000).default(2000),
    pollMs: z.number().step(1).min(20).max(60_000).default(250),
    deliver: z.any().required(),
  })

  readonly name = 'schedule-dispatch'

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
    }, 'schedule-dispatch connection pool')
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
        if (stamped !== undefined && stamped.version !== SCHEDULE_DISPATCH_POSTGRES_SCHEMA_VERSION) {
          throw new Error(
            `schedule dispatch database has schema version ${stamped.version}, incompatible with this build (${SCHEDULE_DISPATCH_POSTGRES_SCHEMA_VERSION})`,
          )
        }
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${SCHEDULE_DUE_TABLE}" (
          task_id      TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL,
          title        TEXT NOT NULL,
          prompt       TEXT NOT NULL,
          next_due_at  BIGINT NOT NULL,
          recurrence   TEXT NOT NULL,
          active       BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at   BIGINT NOT NULL
        )`)
        if (stamped === undefined) {
          await tx.unsafe(`INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${SCHEDULE_DISPATCH_POSTGRES_SCHEMA_VERSION})`)
        }
      })
      return sql
    } catch (error: unknown) {
      await sql.end({ timeout: 1 }).catch(() => {})
      throw error
    }
  }

  /**
   * Create or update one task's due row. The next-due instant is stored as
   * given; the dispatch advances it after each delivery.
   * @param task - the task identity, binding, recurrence, and first due instant.
   */
  async upsertTask(task: ScheduleTask): Promise<void> {
    const sql = await this.ready
    await sql.unsafe(`
      INSERT INTO "${SCHEDULE_DUE_TABLE}" (task_id, session_id, title, prompt, next_due_at, recurrence, active, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
      ON CONFLICT (task_id) DO UPDATE SET
        session_id = $2, title = $3, prompt = $4, next_due_at = $5, recurrence = $6, active = TRUE, updated_at = $7
    `, [task.taskId, task.sessionId, task.title, task.prompt, task.nextDueAt, task.recurrence, Date.now()])
  }

  /**
   * Deactivate one task's row; due dispatch skips inactive rows.
   * @param taskId - the task to cancel.
   */
  async cancelTask(taskId: string): Promise<void> {
    const sql = await this.ready
    await sql.unsafe(`UPDATE "${SCHEDULE_DUE_TABLE}" SET active = FALSE, updated_at = $2 WHERE task_id = $1`, [taskId, Date.now()])
  }

  /**
   * Run the dispatch loop until the signal aborts. Each round is one
   * transaction: take the newest due row under `FOR UPDATE SKIP LOCKED`
   * (the row lock is the exactly-once take), acquire the session lease,
   * deliver, advance next-due, commit. A delivery throw rolls the whole
   * round back — the row stays due and the next round redelivers
   * (at-least-once per occurrence).
   * @param signal - the runner's lifecycle; the loop exits on abort.
   */
  async runLoop(signal: AbortSignal): Promise<void> {
    const nodeId = this.config.nodeId
    if (nodeId === undefined) {
      throw new Error('schedule-dispatch: nodeId is required to run the dispatch loop')
    }
    const deliver = this.config.deliver
    const pollMs = this.config.pollMs ?? 250
    const leaseTtlMs = this.config.leaseTtlMs ?? 2000
    const lease: SessionLease = this.ctx.sessionLease
    const sql = await this.ready
    while (!signal.aborted) {
      let idle = false
      try {
        const round = await sql.begin(async (tx) => {
          const rows = await tx.unsafe(`
            SELECT task_id, session_id, title, prompt, recurrence, next_due_at
            FROM "${SCHEDULE_DUE_TABLE}"
            WHERE active = TRUE AND next_due_at <= $1
            ORDER BY next_due_at
            FOR UPDATE SKIP LOCKED LIMIT 1
          `, [Date.now()]) as Array<DueRow>
          const row = rows[0]
          if (row === undefined) return { taken: false, delivered: false }
          const task: ScheduleTask = {
            taskId: row.task_id,
            sessionId: row.session_id,
            title: row.title,
            prompt: row.prompt,
            recurrence: row.recurrence,
            nextDueAt: Number(row.next_due_at),
          }
          const outcome = await lease.acquire(SessionId(task.sessionId), nodeId, leaseTtlMs)
          if (outcome.status === 'held') {
            // The session's owner delivers its reminders; roll this round
            // back so the row stays due for the next poll.
            return { taken: true, delivered: false }
          }
          await deliver(task)
          await this.advanceTx(tx, task)
          return { taken: true, delivered: true }
        })
        idle = !round.taken
        // A held lease or an idle table waits one poll interval; a delivered
        // row loops immediately in case more work is due.
        if (!round.delivered) await this.wait(pollMs, signal)
      } catch (error: unknown) {
        // The round rolled back: the row stays due and is redelivered next
        // round (at-least-once per occurrence).
        if (!signal.aborted) {
          this.ctx.logger.warn(`schedule-dispatch: delivery round failed (rows stay due): ${String(error)}`)
        }
        await this.wait(pollMs, signal)
      }
      if (signal.aborted) break
      void idle
    }
  }

  /**
   * Advance one delivered row inside the take transaction: recurring rows
   * skip whole missed periods and land on the first strictly future instant
   * (only the latest missed occurrence was delivered); one-shot rows
   * deactivate.
   */
  private async advanceTx(tx: postgresType.TransactionSql, task: ScheduleTask): Promise<void> {
    const now = Date.now()
    if (task.recurrence === 'once') {
      await tx.unsafe(
        `UPDATE "${SCHEDULE_DUE_TABLE}" SET active = FALSE, updated_at = $2 WHERE task_id = $1`,
        [task.taskId, now],
      )
      return
    }
    const interval = Number(task.recurrence.slice('interval:'.length))
    if (!Number.isSafeInteger(interval) || interval <= 0) {
      // An unreadable recurrence deactivates the row: a row that can never be
      // delivered correctly must not loop forever.
      await tx.unsafe(
        `UPDATE "${SCHEDULE_DUE_TABLE}" SET active = FALSE, updated_at = $2 WHERE task_id = $1`,
        [task.taskId, now],
      )
      this.ctx.logger.warn(`schedule-dispatch: task "${task.taskId}" has an unreadable recurrence ${task.recurrence}; deactivated`)
      return
    }
    // The delivered occurrence was the stored next-due (possibly long past).
    // Advance by whole periods until strictly future: only the latest missed
    // occurrence got a delivery, the earlier ones are skipped by design.
    let next = task.nextDueAt + interval
    while (next <= now) next += interval
    await tx.unsafe(
      `UPDATE "${SCHEDULE_DUE_TABLE}" SET next_due_at = $2, updated_at = $3 WHERE task_id = $1`,
      [task.taskId, next, now],
    )
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

export default PostgresScheduleDispatch

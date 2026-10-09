/**
 * Agent dispatch queue and runner orchestration. Entry points publish a
 * session id to the shared queue (`INSERT … ON CONFLICT DO NOTHING`, so one
 * session is queued at most once); runner nodes run the orchestration loop:
 * take one queued id, acquire its session lease, resume the session from
 * shared persistence (the durable inbox projection drives continuation),
 * cancel the agent the moment `waitLost` settles, and release when idle.
 * `agent-loop` never sees a lease.
 * @module @deepseek-ai/dsh-agent-dispatch
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import postgres from 'postgres'
import type postgresType from 'postgres'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLease } from '@deepseek-ai/dsh-session-lease'
import type { StreamRelay } from '@deepseek-ai/dsh-stream-relay'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** The dispatch queue table this provider owns. */
export const DISPATCH_QUEUE_TABLE = 'agent_dispatch_queue'

/** The physical layout version stamped in `agent_dispatch_postgres_meta`. */
export const AGENT_DISPATCH_POSTGRES_SCHEMA_VERSION = 1

const META_TABLE = 'agent_dispatch_postgres_meta'
const LAYOUT_LOCK_KEY = 'dsh-agent-dispatch:layout'

/** The wake channel; entry points notify it on every enqueue. */
const WAKE_CHANNEL = 'agent_dispatch_wake'

/** Plugin configuration. */
export interface Config {
  /**
   * `postgres://` connection string of the shared dispatch database. The
   * database (and schema) must already exist; the provider creates its
   * tables on connect. Connect failures surface at the first use.
   */
  connectionString: string
  /** Connection pool size; queue traffic is one-statement and low-volume. */
  max?: number
  /** This runner node's lease identity; required to start the loop. */
  nodeId?: string
  /** Lease lifetime in milliseconds; the heartbeat interval derives from it. */
  leaseTtlMs?: number
  /** Fallback polling interval while waiting for queued work. */
  pollMs?: number
  /** Grace period after a resumed session's agent goes idle before the lease releases. */
  idleGraceMs?: number
}

/** One dispatch queue row. */
interface QueueRow {
  session_id: string
}

/**
 * The PostgreSQL dispatch queue plus its runner orchestration loop. Load as
 * a plugin; entry points call {@link PostgresAgentDispatch.publish} and
 * runner nodes call {@link PostgresAgentDispatch.runLoop}.
 */
export class PostgresAgentDispatch {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(2),
    leaseTtlMs: z.number().step(1).min(50).max(300_000).default(2000),
    pollMs: z.number().step(1).min(20).max(60_000).default(250),
    idleGraceMs: z.number().step(1).min(0).max(600_000).default(5000),
  })

  readonly name = 'agent-dispatch'

  private readonly ready: Promise<postgresType.Sql>
  private closing: Promise<void> | undefined
  /** LISTEN handle of the active loop, so teardown can drop it before closing. */
  private loopListener: { unlisten(): Promise<void> } | undefined
  /** Set by {@link drain}; the loop stops taking new work and exits after the in-flight round. */
  private draining = false
  /** The in-flight drive round, tracked so {@link drain} waits for its turn boundary. */
  private inFlight: Promise<void> | undefined

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
    }, 'agent-dispatch connection pool')
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
        if (stamped !== undefined && stamped.version !== AGENT_DISPATCH_POSTGRES_SCHEMA_VERSION) {
          throw new Error(
            `dispatch database has schema version ${stamped.version}, incompatible with this build (${AGENT_DISPATCH_POSTGRES_SCHEMA_VERSION})`,
          )
        }
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS "${DISPATCH_QUEUE_TABLE}" (
          session_id  TEXT PRIMARY KEY,
          enqueued_at BIGINT NOT NULL
        )`)
        if (stamped === undefined) {
          await tx.unsafe(`INSERT INTO "${META_TABLE}" (singleton, version) VALUES (1, ${AGENT_DISPATCH_POSTGRES_SCHEMA_VERSION})`)
        }
      })
      return sql
    } catch (error: unknown) {
      await sql.end({ timeout: 1 }).catch(() => {})
      throw error
    }
  }

  /**
   * Enqueue one session for execution. Idempotent per session: an already
   * queued session keeps its original position; the wake notifies every
   * waiting runner either way.
   * @param id - the session to dispatch.
   */
  async publish(id: SessionId): Promise<void> {
    const sql = await this.ready
    await sql.unsafe(
      `INSERT INTO "${DISPATCH_QUEUE_TABLE}" (session_id, enqueued_at) VALUES ($1, $2) ON CONFLICT (session_id) DO NOTHING`,
      [id, Date.now()],
    )
    await sql.notify(WAKE_CHANNEL, id)
  }

  /**
   * Run the orchestration loop until the signal aborts: take queued session
   * ids, acquire their leases, resume and drive them, cancel on lease loss,
   * release when idle. A lease that never becomes free parks the session
   * behind the retry poll, never concurrent execution.
   * @param signal - the runner's lifecycle; the loop exits on abort.
   */
  async runLoop(signal: AbortSignal): Promise<void> {
    const nodeId = this.config.nodeId
    if (nodeId === undefined) {
      throw new Error('agent-dispatch: nodeId is required to run the orchestration loop')
    }
    const ttlMs = this.config.leaseTtlMs ?? 2000
    const pollMs = this.config.pollMs ?? 250
    const idleGraceMs = this.config.idleGraceMs ?? 5000
    const lease: SessionLease = this.ctx.sessionLease
    const sql = await this.ready
    let fireWake: (() => void) | undefined
    const listener = await sql.listen(WAKE_CHANNEL, () => {
      fireWake?.()
    })
    this.loopListener = listener
    try {
      while (!signal.aborted && !this.draining) {
        const taken = await this.take(sql)
        if (taken === undefined) {
          await this.wait(pollMs, signal, (fire) => {
            fireWake = fire
          })
          continue
        }
        const session = taken.session_id
        const outcome = await lease.acquire(SessionId(session), nodeId, ttlMs)
        if (outcome.status === 'held') {
          // Another runner holds the session; it owns execution. Requeue so
          // the session is dispatched again once the holder stops renewing.
          await this.publish(SessionId(session))
          continue
        }
        // Track the round so drain() waits for this drive to its turn
        // boundary before returning.
        const round = this.drive(SessionId(session), nodeId, ttlMs, idleGraceMs, signal)
        this.inFlight = round
        await round
        this.inFlight = undefined
      }
    } finally {
      this.loopListener = undefined
      await listener.unlisten()
    }
  }

  /**
   * Drain this runner for a rolling upgrade: stop taking new work (queued
   * sessions flow to the remaining runners), stop renewing held leases (they
   * expire and are taken over), and wait for the in-flight drive to reach its
   * turn boundary before returning. The caller then exits the process; the
   * upgraded runner resumes the session from shared persistence.
   * @returns resolution once the loop has stopped and the in-flight drive
   *   reached its turn boundary.
   */
  async drain(): Promise<void> {
    this.draining = true
    await this.inFlight?.catch(() => undefined)
    this.inFlight = undefined
  }

  /**
   * End the connection pool explicitly; the context effect also closes it,
   * but an explicit close lets a driver sequence teardown before other pools.
   */
  async closePool(): Promise<void> {
    this.closing ??= (async () => {
      await this.loopListener?.unlisten().catch(() => undefined)
      this.loopListener = undefined
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

  /**
   * Take the oldest queued session id, removing it from the queue.
   * @param sql - the pool handle.
   */
  private async take(sql: postgresType.Sql): Promise<QueueRow | undefined> {
    const rows = await sql.unsafe(
      `DELETE FROM "${DISPATCH_QUEUE_TABLE}"
       WHERE session_id = (SELECT session_id FROM "${DISPATCH_QUEUE_TABLE}" ORDER BY enqueued_at LIMIT 1)
       RETURNING session_id`,
    ) as Array<QueueRow>
    return rows[0]
  }

  /** Wait one poll interval or until a wake fires. */
  private async wait(pollMs: number, signal: AbortSignal, arm: (wake: () => void) => void): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve()
      }, pollMs)
      const stop = (): void => {
        clearTimeout(timer)
        resolve()
      }
      signal.addEventListener('abort', stop, { once: true })
      arm(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * Drive one resumed session: heartbeat the lease, run the agent until
   * idle, cancel the moment the lease is lost, release afterwards.
   */
  private async drive(session: SessionId, nodeId: string, ttlMs: number, idleGraceMs: number, loopSignal: AbortSignal): Promise<void> {
    const lease: SessionLease = this.ctx.sessionLease
    const heartbeat = setInterval(() => {
      void lease.renew(session, nodeId, ttlMs).catch(() => undefined)
    }, Math.max(50, Math.floor(ttlMs / 3)))
    let handle: AgentHandle | undefined
    try {
      // This runner is the session's owner: relay its live events and frames
      // so replicas' follow streams see the turn in real time. The relay is
      // optional — a deployment without one keeps its local-only view.
      const relay: StreamRelay | undefined = this.ctx.get('streamRelay')
      if (relay !== undefined) {
        this.ctx.on('session/event', (source, event) => {
          if (source.id !== session) return
          void relay.publish(session, 'session-event', event as unknown as JsonValue).catch(() => undefined)
        })
        this.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
          if (agent.session.id !== session) return
          void relay.publish(session, 'stream-frame', frame as unknown as JsonValue).catch(() => undefined)
        })
      }
      const resume = this.ctx.get('agents')?.resume.bind(this.ctx.get('agents'))
      if (resume !== undefined) {
        handle = await resume({ resumeSessionId: session })
      }
      const lost = lease.waitLost(session, nodeId, Math.max(50, Math.floor(ttlMs / 5)), loopSignal)
      lost.then(() => {
        handle?.agent.cancel({ kind: 'disposed' }, { keepInbox: true })
      }, () => undefined)
      await handle?.agent.whenIdle()
      await new Promise(resolve => setTimeout(resolve, idleGraceMs))
    } catch (error: unknown) {
      if (loopSignal.aborted) return
      this.ctx.logger.warn(`agent-dispatch: session "${session}" drive failed: ${String(error)}`)
    } finally {
      clearInterval(heartbeat)
      await handle?.dispose().catch(() => undefined)
      await lease.release(session, nodeId).catch(() => undefined)
    }
  }
}

export default PostgresAgentDispatch

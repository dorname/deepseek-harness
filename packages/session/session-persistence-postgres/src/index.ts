/**
 * PostgreSQL durable session-persistence backend. It stores each session's
 * header and committed generation pointer in a `sessions` row, committed
 * generations as immutable byte-range rows, and the newest writes in a live
 * tail row, and serves the handle-based `SessionPersistence` API:
 * `create`/`open` return per-session handles, a session-level advisory lock
 * arbitrates the single writer across nodes, and every read validates the
 * same fail-closed storage contract.
 * @module @deepseek-ai/dsh-session-persistence-postgres
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type postgres from 'postgres'
import { createHash } from 'node:crypto'
import {
  SessionPersistence,
  SessionPersistenceRevision,
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  SessionAlreadyExistsError,
  SessionPersistenceNotFoundError,
  assertStoredId,
  assertVersion,
  materializeCreateHeader,
  sessionFormatVersionRefusal,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import { SESSION_FORMAT_VERSION, SessionId as makeSessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { connectDatabase, GENERATIONS_TABLE, SESSIONS_TABLE, TAIL_TABLE } from './schema.ts'
import { assertSeededCut, decodeEventLog, encodeEventLines } from './format.ts'
import { PostgresWriteLease } from './lease.ts'
import {
  PostgresBackendTracker,
  PostgresSessionHandle,
  type PostgresHandleStorage,
  type StoredSnapshot,
} from './storage.ts'

/** Plugin configuration for the PostgreSQL backend. */
export interface Config {
  /**
   * `postgres://` connection string of the shared database. The database (and
   * schema) must already exist; the backend creates its tables on connect.
   * Connect failures surface at the first use of the backend.
   */
  connectionString: string
  /**
   * Connection pool size for read and append traffic. Every write handle
   * additionally reserves one dedicated connection for its advisory lock for
   * the handle's lifetime, so size the pool for the expected concurrent
   * readers and appending handles.
   */
  max?: number
}

/** Whether a PostgreSQL error is the unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505'
}

/** Restore a validated current-format header from its stored JSON record. */
function restoreHeader(value: unknown): SessionHeader {
  if (typeof value !== 'object' || value === null) {
    throw new SessionPersistenceCorruptionError('stored session header is not a JSON object', {
      cause: new Error(`header record: ${String(value)}`),
    })
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.createdAt !== 'number'
    || typeof record.isSeeded !== 'boolean' || record.version !== SESSION_FORMAT_VERSION) {
    throw new SessionPersistenceCorruptionError('stored session header is malformed for the current format', {
      cause: new Error(`header record fields: ${JSON.stringify(record)}`),
    })
  }
  return {
    version: SESSION_FORMAT_VERSION,
    id: makeSessionId(record.id),
    createdAt: record.createdAt,
    ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
    ...(typeof record.parentSession === 'string'
      ? { parentSession: makeSessionId(record.parentSession) }
      : {}),
    isSeeded: record.isSeeded,
    ...(record.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
    delegationDepth: typeof record.delegationDepth === 'number' ? record.delegationDepth : 0,
    ...(typeof record.agentPreset === 'string' ? { agentPreset: record.agentPreset } : {}),
  }
}

/** The tail side of the backend-authored `<generation>:<tail digest>` revision token. */
function tailDigest(tail: string | undefined): string {
  return createHash('sha256').update(tail ?? '', 'utf8').digest('hex').slice(0, 16)
}

/** One row of the stat/list projection. */
interface SessionRow {
  format_version: number
  header: string
  current_generation: number
  inherited_event_count: number
}

/**
 * The PostgreSQL persistence backend. Load as a plugin; it registers as
 * `ctx.sessionPersistence`. Sessions materialize lazily: a created session is
 * visible to this process immediately, reaches the shared database on its
 * first append or flush, and never existed if the process crashes before
 * that.
 */
class PostgresSessionPersistence extends SessionPersistence implements PostgresHandleStorage {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(4),
  })

  /** Backend label for diagnostics and effects; shadows `Service.name` without changing the service key. */
  override readonly name = 'session-persistence-postgres'

  private readonly ready: Promise<postgres.Sql>
  private closing: Promise<void> | undefined
  private readonly tracker = new PostgresBackendTracker(this.name)
  /** Counter for in-memory pending revision tokens. */
  private revisionCounter = 0

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.ready = connectDatabase(config.connectionString, config.max ?? 4)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    // One teardown effect, sequenced: close every open handle first (close
    // drains the routed buffer, which needs the pool), then release the pool.
    // Effect disposers unwind concurrently, so a separate pool effect could
    // end the medium under an in-flight drain.
    ctx.effect(() => async () => {
      try {
        await this.tracker.closeOpenHandles()
      } finally {
        await this.closePool()
      }
    }, 'session-persistence-postgres teardown')
    this.tracker.install(ctx)
  }

  private closePool(): Promise<void> {
    this.closing ??= (async () => {
      try {
        const sql = await this.ready
        await sql.end({ timeout: 5 })
      } catch {
        // The pool never connected; that failure already rejected the first
        // caller, and there is nothing left to release here.
      }
    })()
    return this.closing
  }

  // --- SessionPersistence service API ---

  /**
   * Create a new stored session and take its write ownership. The session is
   * visible to this process immediately; the shared-database row appears on
   * the first append or flush.
   * @param header - the immutable header to store; must be losslessly
   *   JSON-serializable with a non-negative safe-integer `createdAt`.
   * @param options - optional cancellation and fork-inherited cut.
   * @returns the owned write handle.
   */
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    // Fail fast on a seeded/cut mismatch before anything registers.
    assertSeededCut(snapshot, options?.inheritedEventCount)
    const inheritedEventCount = SessionLogOffset(options?.inheritedEventCount ?? 0)
    options?.signal?.throwIfAborted()
    const sql = await this.ready
    options?.signal?.throwIfAborted()
    if (this.tracker.hasPending(snapshot.id) || await this.rowExists(sql, snapshot.id)) {
      throw new SessionAlreadyExistsError(snapshot.id)
    }
    options?.signal?.throwIfAborted()
    // No lock yet: before materialization there is no durable row for another
    // process to contend over, so the handle acquires the advisory lock right
    // before its first row publishes (ensureLease); an unmaterialized session
    // leaves no shared-database footprint at all.
    this.revisionCounter += 1
    this.tracker.registerCreated(
      snapshot,
      `memory:${this.name}:${this.revisionCounter}`,
      inheritedEventCount,
    )
    return this.tracker.adopt(new PostgresSessionHandle(this, snapshot.id, snapshot, 'write', {
      cursor: 0,
      materialized: false,
      needsTailRepair: false,
      inheritedEventCount,
    }))
  }

  /**
   * Open an existing stored session for `read` or single-writer `write`.
   * @param id - the stored session to open.
   * @param access - `read` (no ownership) or `write` (atomic in-process claim
   *   plus the cross-process advisory lock).
   * @param options - optional cancellation.
   * @returns the open handle.
   */
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const sql = await this.ready
    options?.signal?.throwIfAborted()
    const pending = this.tracker.pendingOf(id)
    if (access === 'read') {
      if (pending !== undefined) {
        return this.tracker.adopt(new PostgresSessionHandle(this, id, pending.header, 'read', {
          cursor: 0,
          materialized: false,
          needsTailRepair: false,
          inheritedEventCount: pending.inheritedEventCount,
        }))
      }
      const snapshot = await this.readStoredSnapshot(id, options?.signal)
      if (snapshot === undefined) throw new SessionPersistenceNotFoundError(id)
      return this.tracker.adopt(new PostgresSessionHandle(this, id, snapshot.meta, 'read', {
        cursor: 0,
        materialized: true,
        needsTailRepair: false,
        inheritedEventCount: snapshot.inheritedEventCount,
      }))
    }
    // A pending entry always belongs to an ACTIVE creator handle (close erases
    // it), so the claim below rejects that case as already owned.
    this.tracker.claimWrite(id)
    let lease: PostgresWriteLease | undefined
    try {
      const snapshot = await this.readStoredSnapshot(id, options?.signal)
      if (snapshot === undefined) throw new SessionPersistenceNotFoundError(id)
      options?.signal?.throwIfAborted()
      lease = await PostgresWriteLease.acquire(sql, snapshot.meta)
      return this.tracker.adopt(new PostgresSessionHandle(this, id, snapshot.meta, 'write', {
        cursor: snapshot.events.length,
        materialized: true,
        needsTailRepair: snapshot.tornTail,
        inheritedEventCount: snapshot.inheritedEventCount,
        primed: { eventState: 'detached', events: snapshot.events },
      }, lease))
    } catch (error: unknown) {
      // Free the in-process claim no matter how the lock release fares, and
      // keep the original diagnostic: a release failure joins it instead of
      // replacing it.
      const failure = error instanceof Error ? error : new Error(String(error))
      let releaseFailure: Error | undefined
      try {
        await lease?.release()
      } catch (raw: unknown) {
        releaseFailure = raw instanceof Error ? raw : new Error(String(raw))
      }
      this.tracker.releaseClaim(id)
      if (releaseFailure !== undefined) {
        throw new AggregateError([failure, releaseFailure], `session "${id}": write open failed and its lock release failed`)
      }
      throw failure
    }
  }

  /**
   * Flush every active write handle in one durability barrier; see the seam
   * contract.
   * @returns resolution once every write handle active at the call has flushed.
   */
  flush(): Promise<void> {
    return this.tracker.flushAll()
  }

  /**
   * Observe one stored session without reading its event log.
   * @param id - the stored session to observe.
   * @param options - optional cancellation.
   * @returns the snapshot (`sizeBytes` carries the physical byte size), or
   *   `undefined` when the session does not exist.
   */
  async stat(
    id: SessionId,
    options?: SessionPersistenceStatOptions,
  ): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const pending = this.tracker.pendingOf(id)
    if (pending !== undefined) {
      return { header: pending.header, revision: SessionPersistenceRevision(pending.revision) }
    }
    const sql = await this.ready
    options?.signal?.throwIfAborted()
    const rows = await sql.unsafe(`
      SELECT s.format_version, s.header, s.current_generation,
        COALESCE((SELECT SUM(LENGTH(g.bytes)) FROM "${GENERATIONS_TABLE}" g WHERE g.id = s.id), 0) AS generation_size,
        t.bytes AS tail
      FROM "${SESSIONS_TABLE}" s LEFT JOIN "${TAIL_TABLE}" t ON t.id = s.id
      WHERE s.id = $1
    `, [id]) as Array<SessionRow & { generation_size: string; tail: string | undefined }>
    options?.signal?.throwIfAborted()
    const row = rows[0]
    if (row === undefined) return undefined
    const meta = this.rowHeader(id, row)
    return {
      header: meta,
      revision: SessionPersistenceRevision(`${row.current_generation}:${tailDigest(row.tail)}`),
      sizeBytes: Number(row.generation_size) + Buffer.byteLength(row.tail ?? ''),
    }
  }

  /**
   * List every stored session visible to this process: materialized rows plus
   * this process's created-but-unmaterialized sessions.
   * @param options - optional cancellation.
   * @returns one snapshot per session, in no promised order.
   */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const signal = options?.signal
    const sql = await this.ready
    const snapshots: SessionPersistenceSnapshot[] = []
    const listed = new Set<SessionId>()
    // Snapshot pending entries BEFORE scanning storage: a session whose first
    // append lands mid-scan is then still in this snapshot (its row may
    // predate the scan), so create-to-list visibility never has a hole.
    const pending = [...this.tracker.pendingEntries()]
    const rows = await sql.unsafe(`
      SELECT s.id, s.format_version, s.header, s.current_generation,
        COALESCE((SELECT SUM(LENGTH(g.bytes)) FROM "${GENERATIONS_TABLE}" g WHERE g.id = s.id), 0) AS generation_size,
        t.bytes AS tail
      FROM "${SESSIONS_TABLE}" s LEFT JOIN "${TAIL_TABLE}" t ON t.id = s.id
    `) as Array<SessionRow & { id: string; generation_size: string; tail: string | undefined }>
    for (const row of rows) {
      signal?.throwIfAborted()
      try {
        const id = makeSessionId(row.id)
        const meta = this.rowHeader(id, row)
        listed.add(id)
        snapshots.push({
          header: meta,
          revision: SessionPersistenceRevision(`${row.current_generation}:${tailDigest(row.tail)}`),
          sizeBytes: Number(row.generation_size) + Buffer.byteLength(row.tail ?? ''),
        })
      } catch (error: unknown) {
        // A row this build refuses to interpret (unknown format, damaged
        // header) is invisible to listing, mirroring the filesystem backend.
        if (error instanceof SessionFormatUnsupportedError
          || error instanceof SessionPersistenceCorruptionError) continue
        throw error
      }
    }
    for (const [id, entry] of pending) {
      if (!listed.has(id)) {
        snapshots.push({ header: entry.header, revision: SessionPersistenceRevision(entry.revision) })
      }
    }
    signal?.throwIfAborted()
    return snapshots
  }

  // --- handle-facing storage internals (the provider-local runtime) ---

  /** Whether the id already has a materialized row. */
  private async rowExists(sql: postgres.Sql, id: SessionId): Promise<boolean> {
    const rows = await sql.unsafe(`SELECT 1 FROM "${SESSIONS_TABLE}" WHERE id = $1`, [id])
    return rows.length > 0
  }

  /** Parse and validate one stat/list row's header under the format gate. */
  private rowHeader(rowId: SessionId, row: SessionRow): SessionHeader {
    if (row.format_version !== SESSION_FORMAT_VERSION) {
      throw new SessionFormatUnsupportedError(sessionFormatVersionRefusal(rowId, row.format_version))
    }
    const meta = restoreHeader(JSON.parse(row.header))
    assertStoredId(rowId, meta)
    assertVersion(meta)
    return meta
  }

  /**
   * Read and validate the stored log: committed generations plus the tail's
   * complete lines, in one statement so generations and tail are one
   * consistent snapshot.
   */
  async readStoredSnapshot(id: SessionId, signal?: AbortSignal): Promise<StoredSnapshot | undefined> {
    const sql = await this.ready
    signal?.throwIfAborted()
    const rows = await sql.unsafe(`
      SELECT s.format_version, s.header, s.current_generation, s.inherited_event_count,
        COALESCE((
          SELECT string_agg(g.bytes, '' ORDER BY g.generation)
          FROM "${GENERATIONS_TABLE}" g WHERE g.id = s.id
        ), ''::bytea) AS generation_bytes,
        t.bytes AS tail
      FROM "${SESSIONS_TABLE}" s LEFT JOIN "${TAIL_TABLE}" t ON t.id = s.id
      WHERE s.id = $1
    `, [id]) as Array<{
      format_version: number
      header: string
      current_generation: number
      inherited_event_count: number
      generation_bytes: Buffer
      tail: string | undefined
    }>
    signal?.throwIfAborted()
    const row = rows[0]
    if (row === undefined) return undefined
    if (row.format_version !== SESSION_FORMAT_VERSION) {
      throw new SessionFormatUnsupportedError(sessionFormatVersionRefusal(id, row.format_version))
    }
    const meta = restoreHeader(JSON.parse(row.header))
    assertStoredId(id, meta)
    assertVersion(meta)
    let decoded: ReturnType<typeof decodeEventLog>
    try {
      decoded = decodeEventLog(row.generation_bytes, row.tail)
    } catch (error: unknown) {
      throw new SessionPersistenceCorruptionError(
        `session "${id}": stored log is corrupt: ${String(error)}`,
        { cause: error },
      )
    }
    validateStoredEvents(meta, decoded.events)
    return {
      meta,
      inheritedEventCount: SessionLogOffset(row.inherited_event_count),
      events: decoded.events,
      tornTail: decoded.tornTail !== undefined,
      revision: `${row.current_generation}:${tailDigest(row.tail)}`,
    }
  }

  /**
   * Durably append one validated batch; lazily materializes on the first
   * write.
   * @param header - the session's stored header.
   * @param events - the validated contiguous batch, in seq order.
   * @param isMaterialized - whether the session already has a durable row.
   * @param inheritedEventCount - the exact fork-inherited prefix length.
   */
  async persistBatch(
    header: SessionHeader,
    events: readonly SessionEvent[],
    isMaterialized: boolean,
    inheritedEventCount: SessionLogOffset,
  ): Promise<void> {
    if (isMaterialized) {
      await this.appendToTail(header, events)
    } else {
      await this.materializeRow(header, inheritedEventCount, events)
      this.tracker.materialized(header.id)
    }
  }

  /**
   * Materialize a header-only row for an explicitly durable empty session.
   * @param header - the session's stored header.
   * @param inheritedEventCount - the exact fork-inherited prefix length.
   */
  async persistHeader(header: SessionHeader, inheritedEventCount: SessionLogOffset): Promise<void> {
    await this.materializeRow(header, inheritedEventCount, [])
    this.tracker.materialized(header.id)
  }

  /**
   * Insert the sessions row (and the first generation when the batch is not
   * empty) in one transaction; the primary-key conflict is the failed
   * exclusive publication when another node materialized the same id first.
   */
  private async materializeRow(
    header: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
  ): Promise<void> {
    const sql = await this.ready
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`
          INSERT INTO "${SESSIONS_TABLE}"
            (id, format_version, header, current_generation, inherited_event_count, created_at, updated_at)
          VALUES ($1, $2, $3, 0, $4, $5, $6)
        `, [header.id, SESSION_FORMAT_VERSION, JSON.stringify(header), inheritedEventCount, header.createdAt, Date.now()])
        if (events.length > 0) {
          await tx.unsafe(
            `INSERT INTO "${GENERATIONS_TABLE}" (id, generation, bytes) VALUES ($1, 1, $2)`,
            [header.id, Buffer.from(encodeEventLines(events), 'utf8')],
          )
          await tx.unsafe(
            `UPDATE "${SESSIONS_TABLE}" SET current_generation = 1, updated_at = $2 WHERE id = $1`,
            [header.id, Date.now()],
          )
        }
      })
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw new SessionAlreadyExistsError(header.id)
      throw error
    }
  }

  /** Append encoded events to the tail in one transaction (batch-commit durable). */
  private async appendToTail(header: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
    const sql = await this.ready
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO "${TAIL_TABLE}" (id, bytes) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET bytes = "${TAIL_TABLE}".bytes || EXCLUDED.bytes
      `, [header.id, encodeEventLines(events)])
      await tx.unsafe(
        `UPDATE "${SESSIONS_TABLE}" SET updated_at = $2 WHERE id = $1`,
        [header.id, Date.now()],
      )
    })
  }

  /**
   * Truncate an unterminated tail line before this session's first new
   * append. A torn line holds no complete record, so the repair is a
   * truncation; committed generation rows are never touched.
   * @param header - the session's stored header.
   */
  async truncateTornTail(header: SessionHeader): Promise<void> {
    const sql = await this.ready
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `UPDATE "${TAIL_TABLE}" SET bytes = regexp_replace(bytes, '[^\\n]*$', '') WHERE id = $1`,
        [header.id],
      )
      await tx.unsafe(`DELETE FROM "${TAIL_TABLE}" WHERE id = $1 AND bytes = ''`, [header.id])
      await tx.unsafe(
        `UPDATE "${SESSIONS_TABLE}" SET updated_at = $2 WHERE id = $1`,
        [header.id, Date.now()],
      )
    })
    this.ctx.logger.warn(`${this.name}: session "${header.id}" recovered from a torn tail; the incomplete tail line was discarded`)
  }

  /**
   * Fold the tail into a new immutable committed generation in one
   * transaction (the flush barrier). An empty tail is a satisfied barrier; a
   * torn tail refuses publication — repair it with an append first.
   * @param header - the session's stored header.
   */
  async publishGeneration(header: SessionHeader): Promise<void> {
    const sql = await this.ready
    try {
      await sql.begin(async (tx) => {
        const tailRows = await tx.unsafe(
          `SELECT bytes FROM "${TAIL_TABLE}" WHERE id = $1 FOR UPDATE`,
          [header.id],
        ) as Array<{ bytes: string }>
        const tail = tailRows[0]?.bytes
        if (tail === undefined || tail === '') return
        if (!tail.endsWith('\n')) {
          throw new SessionPersistenceCorruptionError(
            `session "${header.id}": the tail ends in an unterminated line; refusing to publish a torn tail`,
            { cause: new Error(`tail byte length: ${Buffer.byteLength(tail)}`) },
          )
        }
        const pointerRows = await tx.unsafe(
          `SELECT current_generation FROM "${SESSIONS_TABLE}" WHERE id = $1 FOR UPDATE`,
          [header.id],
        ) as Array<{ current_generation: number }>
        const pointer = pointerRows[0]
        if (pointer === undefined) {
          throw new SessionPersistenceCorruptionError(`session "${header.id}": the sessions row disappeared while its tail existed`, {
            cause: new Error('session_generations rows referenced a missing sessions row'),
          })
        }
        const generation = pointer.current_generation + 1
        // A primary-key conflict here is the failed exclusive publication —
        // two publishers raced for the same generation number.
        await tx.unsafe(
          `INSERT INTO "${GENERATIONS_TABLE}" (id, generation, bytes) VALUES ($1, $2, $3)`,
          [header.id, generation, Buffer.from(tail, 'utf8')],
        )
        await tx.unsafe(
          `UPDATE "${SESSIONS_TABLE}" SET current_generation = $2, updated_at = $3 WHERE id = $1`,
          [header.id, generation, Date.now()],
        )
        await tx.unsafe(`DELETE FROM "${TAIL_TABLE}" WHERE id = $1`, [header.id])
      })
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new SessionPersistenceCorruptionError(
          `session "${header.id}": exclusive generation publication failed: the generation row already exists`,
          { cause: error },
        )
      }
      throw error
    }
  }

  /**
   * Whether this process still tracks a created-but-unmaterialized session.
   * @param id - the session to test.
   */
  hasPendingSession(id: SessionId): boolean {
    return this.tracker.hasPending(id)
  }

  /**
   * Release one handle's backend bookkeeping on close.
   * @param handle - the closing handle.
   * @param materialized - whether the session reached durable storage.
   */
  releaseHandle(handle: PostgresSessionHandle, materialized: boolean): void {
    this.tracker.release(handle, materialized)
  }

  /**
   * Acquire the session's cross-process advisory write lock on a reserved
   * connection; process death closes the connection and releases the lock.
   * @param header - the session's stored header.
   * @returns the held lock.
   */
  async acquireWriteLease(header: SessionHeader): Promise<PostgresWriteLease> {
    return PostgresWriteLease.acquire(await this.ready, header)
  }
}

export default PostgresSessionPersistence

/**
 * The PostgreSQL cross-process write lease: a session-level advisory lock
 * (`pg_try_advisory_lock`) held on one reserved pool connection for the
 * handle's whole lifetime. The dedicated connection keeps the lock off the
 * shared pool (a pooled connection must never carry a session-scoped lock
 * between borrows), and process death closes the connection, releasing the
 * lock — the database arbitrates exactly where the JSONL backend uses a
 * kernel file lock.
 * @module @deepseek-ai/dsh-session-persistence-postgres/lease
 */

import type postgres from 'postgres'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'

/** One held cross-process write lock plus its dedicated connection. */
export class PostgresWriteLease {
  private released = false

  private constructor(
    private readonly reserved: postgres.ReservedSql,
    readonly id: SessionId,
  ) {}

  /**
   * Acquire the session's advisory write lock on a freshly reserved
   * connection.
   * @param sql - the backend pool to reserve from.
   * @param header - the session header naming the id to lock.
   * @returns the held lease.
   * @throws {SessionAlreadyOwnedError} when another node holds the lock.
   * @throws {Error} when the reservation itself fails; the reservation is
   *   released before the failure propagates.
   */
  static async acquire(sql: postgres.Sql, header: SessionHeader): Promise<PostgresWriteLease> {
    const reserved = await sql.reserve()
    try {
      const rows = await reserved.unsafe('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [header.id]) as Array<{ ok: boolean }>
      if (rows[0]?.ok !== true) {
        throw new SessionAlreadyOwnedError(header.id)
      }
    } catch (error: unknown) {
      reserved.release()
      throw error
    }
    return new PostgresWriteLease(reserved, header.id)
  }

  /**
   * Release the lock and the reserved connection. Idempotent; a release
   * failure still marks the lease released so the in-process claim is not
   * wedged behind a lock the server may already have dropped.
   * @returns resolution once the connection is back in the pool.
   */
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    try {
      await this.reserved.unsafe('SELECT pg_advisory_unlock(hashtext($1))', [this.id])
    } finally {
      this.reserved.release()
    }
  }
}

/**
 * Session-lease Service Definition (`ctx.sessionLease`): the cross-node
 * single-writer claim for one session — the database-side twin of the JSONL
 * backend's in-process writer claim. A runner acquires before starting an
 * agent, renews by heartbeat, and cancels the agent when
 * {@link SessionLease.waitLost} settles; `agent-loop` itself never sees a
 * lease.
 * @module @deepseek-ai/dsh-session-lease
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionLease: SessionLease
  }
}

/** Who holds a lease and until when (epoch milliseconds). */
export interface LeaseFacts {
  /** The holding runner's node identifier. */
  readonly owner: string
  /** Expiry in epoch milliseconds; a lease past this moment is takeable. */
  readonly expiresAt: number
}

/** One `acquire` attempt: either the caller now holds the lease, or another live holder refused it. */
export type AcquireOutcome =
  | { readonly status: 'acquired' }
  | { readonly status: 'held'; readonly holder: LeaseFacts }

/**
 * Abstract cross-node session lease. Implementations arbitrate atomically on
 * a shared medium: acquiring a free or expired lease and refusing a live one
 * are one atomic statement, so concurrent acquirers get exactly one winner,
 * and an expired holder's lease is taken over the same way.
 */
export abstract class SessionLease extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionLease')
  }

  /**
   * Atomically acquire the session's lease: a free or expired lease becomes
   * the caller's; a live foreign lease refuses with its facts.
   * @param id - the session to lease.
   * @param owner - the caller's node identifier.
   * @param ttlMs - lease lifetime in milliseconds from now.
   * @returns `acquired`, or `held` naming the current holder and expiry.
   */
  abstract acquire(id: SessionId, owner: string, ttlMs: number): Promise<AcquireOutcome>

  /**
   * Extend the caller's lease; only the current owner may renew.
   * @param id - the leased session.
   * @param owner - the caller's node identifier.
   * @param ttlMs - new lifetime in milliseconds from now.
   * @returns whether the caller still held the lease.
   */
  abstract renew(id: SessionId, owner: string, ttlMs: number): Promise<boolean>

  /**
   * Release the lease; only the current owner may release.
   * @param id - the leased session.
   * @param owner - the caller's node identifier.
   * @returns whether the caller held the lease.
   */
  abstract release(id: SessionId, owner: string): Promise<boolean>

  /**
   * Observe the session's current holder without taking it.
   * @param id - the session to observe.
   * @returns the holder facts, or `undefined` when the session is unleased.
   */
  abstract ownerOf(id: SessionId): Promise<LeaseFacts | undefined>

  /**
   * Resolve when the caller's ownership of the session ends — the lease was
   * released, expired and taken over, or was never the caller's. Runners use
   * this to cancel their agent; `agent-loop` stays unaware.
   * @param id - the leased session.
   * @param owner - the caller's node identifier.
   * @param pollMs - polling interval while watching; the loss latency budget.
   * @param signal - optional cancellation for the watch itself.
   * @returns why ownership ended: the taking-over owner, or `'released'`.
   */
  abstract waitLost(id: SessionId, owner: string, pollMs?: number, signal?: AbortSignal): Promise<string>
}

export default SessionLease

/**
 * Stream-relay Service Definition (`ctx.streamRelay`): the cross-node relay
 * for one session's live records — serialized `session/event` entries and
 * assistant-stream frames — published by the owning runner and replayed to
 * every replica by monotonically increasing per-session sequence numbers.
 * The relay only transports existing records; it never invents, rewrites, or
 * reorders them.
 * @module @deepseek-ai/dsh-stream-relay
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

declare module '@deepseek-ai/cordis' {
  interface Context {
    streamRelay: StreamRelay
  }
}

/** The record kinds the relay transports. */
export type RelayRecordKind = 'session-event' | 'stream-frame'

/** One relayed record: its per-session sequence number, kind, and serialized payload. */
export interface RelayRecord {
  /** Per-session sequence number; strictly increasing, gapless from 1. */
  readonly seq: number
  readonly kind: RelayRecordKind
  readonly payload: JsonValue
}

/** Handler invoked once per record, in sequence order, exactly once per subscriber. */
export type RelayRecordHandler = (record: RelayRecord) => void

/**
 * Abstract stream relay. Implementations publish each record atomically with
 * its next per-session sequence number and wake subscribers; subscribers
 * replay from a cursor so a late join or a missed wake never leaves a gap or
 * a duplicate.
 */
export abstract class StreamRelay extends Service {
  constructor(ctx: Context) {
    super(ctx, 'streamRelay')
  }

  /**
   * Publish one record with the session's next sequence number.
   * @param id - the session the record belongs to.
   * @param kind - the record kind.
   * @param payload - the serialized record body.
   * @returns the record's sequence number.
   */
  abstract publish(id: SessionId, kind: RelayRecordKind, payload: JsonValue): Promise<number>

  /**
   * Read the session's records strictly after a cursor, in sequence order.
   * @param id - the session to read.
   * @param afterSeq - the cursor; 0 replays from the first record.
   * @returns the records after the cursor, possibly empty.
   */
  abstract read(id: SessionId, afterSeq: number): Promise<readonly RelayRecord[]>

  /**
   * Observe the session's latest sequence number.
   * @param id - the session to observe.
   * @returns the latest sequence number, or 0 when nothing is published.
   */
  abstract maxSeq(id: SessionId): Promise<number>

  /**
   * Subscribe to the session's records from a cursor: existing records after
   * the cursor replay first, then live records arrive as published. Wakes may
   * be lost; the implementation catches up on its next wake or poll tick, so
   * a late join and a missed wake both replay without gaps or duplicates.
   * @param id - the session to subscribe to.
   * @param afterSeq - the cursor; 0 subscribes from the first record.
   * @param onRecord - invoked once per record in sequence order.
   * @param pollMs - fallback polling interval; 0 disables polling.
   * @param signal - cancels the subscription and stops delivery.
   * @returns resolution with the unsubscribe function once listening is active.
   */
  abstract subscribe(
    id: SessionId,
    afterSeq: number,
    onRecord: RelayRecordHandler,
    pollMs?: number,
    signal?: AbortSignal,
  ): Promise<() => void>
}

export default StreamRelay

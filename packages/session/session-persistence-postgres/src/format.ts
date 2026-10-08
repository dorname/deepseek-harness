/**
 * Physical encoding for the PostgreSQL session-persistence backend: event
 * logs are newline-delimited JSON, one event per line, split across immutable
 * generation rows (bytes) and the live tail (text). A torn tail is a final
 * line without its terminator — the read path never serves it and the write
 * path repairs it away.
 * @module @deepseek-ai/dsh-session-persistence-postgres/format
 */

import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'

/**
 * Refuse a seeded/cut mismatch at create with the exact semantics every
 * backend enforces before its first materialization: a seeded header requires
 * an inherited cut, an unseeded header requires none.
 * @param header - the caller's header.
 * @param inheritedEventCount - the supplied fork-inherited prefix length.
 * @throws {Error} when the seeding and the cut disagree.
 */
export function assertSeededCut(header: SessionHeader, inheritedEventCount?: SessionLogOffset): void {
  if (header.isSeeded && inheritedEventCount === undefined) {
    throw new Error('seeded session header requires an inherited event count')
  }
  const cut = inheritedEventCount ?? 0
  if (!header.isSeeded && cut !== 0) {
    throw new Error('unseeded session header inherited event count must be 0')
  }
}

/** Encode one append batch or generation body as newline-terminated event lines. */
export function encodeEventLines(events: readonly SessionEvent[]): string {
  let text = ''
  for (const event of events) text += `${JSON.stringify(event)}\n`
  return text
}

/** One decoded physical log: the committed prefix plus any torn final line. */
export interface DecodedEventLog {
  /** Complete event records, in stored order, not yet vocabulary-validated. */
  readonly events: SessionEvent[]
  /** The unterminated final line, when the physical log ends mid-record. */
  readonly tornTail: string | undefined
}

/**
 * Decode generation bytes plus the live tail into complete events and any
 * torn final line. Generation bytes always end on a record terminator; only
 * the tail can end mid-record, and the tail is the last segment of the
 * concatenation.
 * @param generationBytes - concatenated committed generation bytes (possibly empty).
 * @param tail - the live tail text, when a tail row exists.
 * @returns the decoded log.
 * @throws {SyntaxError} when a complete line is not valid JSON.
 */
export function decodeEventLog(generationBytes: Buffer, tail: string | undefined): DecodedEventLog {
  const text = tail === undefined ? generationBytes.toString('utf8') : `${generationBytes.toString('utf8')}${tail}`
  const lastTerminator = text.lastIndexOf('\n')
  const complete = lastTerminator === -1 ? '' : text.slice(0, lastTerminator + 1)
  const torn = text.length > complete.length ? text.slice(complete.length) : undefined
  const events: SessionEvent[] = []
  for (const line of complete.split('\n')) {
    if (line === '') continue
    events.push(JSON.parse(line) as SessionEvent)
  }
  return { events, tornTail: torn }
}

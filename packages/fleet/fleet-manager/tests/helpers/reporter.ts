/**
 * OpenLogos JSONL reporter for fleet test suites.
 *
 * Writes one line per `UT-*` / `ST-*` case into the file named by
 * `OPENLOGOS_RESULT_FILE` (append; truncation is the verify runner's job so
 * parallel suites never clobber each other). Plain `pnpm test` runs never
 * write: without the env var the reporter is a no-op, keeping the repo's
 * normal test runs free of OpenLogos side effects.
 *
 * @module
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Allowed case statuses in the OpenLogos result ledger. */
export type ReportedStatus = 'pass' | 'fail' | 'skip'

/**
 * Record one test case result. No-op unless `OPENLOGOS_RESULT_FILE` is set.
 * @param id - the case id exactly as defined in `logos/resources/test/*.md`.
 * @param status - run outcome.
 * @param error - failure reason; required by the ledger when status is `fail`.
 * @param durationMs - execution duration.
 */
export function reportResult(id: string, status: ReportedStatus, error?: string, durationMs?: number): void {
  const file = process.env.OPENLOGOS_RESULT_FILE
  if (file === undefined) {
    return
  }
  mkdirSync(dirname(file), { recursive: true })
  const record: Record<string, unknown> = { id, status, timestamp: new Date().toISOString() }
  if (durationMs !== undefined) {
    record.duration_ms = durationMs
  }
  if (error !== undefined) {
    record.error = error
  }
  appendFileSync(file, `${JSON.stringify(record)}\n`)
}

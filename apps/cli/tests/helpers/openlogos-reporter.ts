/**
 * OpenLogos result reporter for apps/cli tests (no-op without OPENLOGOS_RESULT_FILE).
 * @module
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Allowed case statuses in the OpenLogos result ledger. */
export type ReportedStatus = 'pass' | 'fail' | 'skip'

/**
 * Record one test case result.
 * @param id - case id from `logos/resources/test/*.md`.
 * @param status - run outcome.
 * @param error - failure reason when status is `fail`.
 * @param durationMs - execution duration.
 */
export function reportResult(id: string, status: ReportedStatus, error?: string, durationMs?: number): void {
  const file = process.env.OPENLOGOS_RESULT_FILE
  if (file === undefined) return
  mkdirSync(dirname(file), { recursive: true })
  const record: Record<string, unknown> = { id, status, timestamp: new Date().toISOString() }
  if (durationMs !== undefined) record.duration_ms = durationMs
  if (error !== undefined) record.error = error
  appendFileSync(file, `${JSON.stringify(record)}\n`)
}

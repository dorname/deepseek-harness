/**
 * OpenLogos JSONL reporter for the S48 model-discovery suites.
 *
 * Writes one line per `UT-*` / `ST-*` case into the file named by
 * `OPENLOGOS_RESULT_FILE` (append; truncation is the verify runner's job).
 * Plain `pnpm test` runs never write: without the env var this is a no-op.
 *
 * @module
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Record one test case result. No-op unless `OPENLOGOS_RESULT_FILE` is set.
 * @param id - the case id exactly as defined in `logos/resources/test/*.md`.
 * @param status - run outcome.
 * @param error - failure reason; required by the ledger when status is `fail`.
 * @param durationMs - execution duration.
 */
export function reportResult(id: string, status: 'pass' | 'fail' | 'skip', error?: string, durationMs?: number): void {
  const file = process.env.OPENLOGOS_RESULT_FILE
  if (file === undefined) return
  mkdirSync(dirname(file), { recursive: true })
  const record: Record<string, unknown> = { id, status, timestamp: new Date().toISOString() }
  if (durationMs !== undefined) record.duration_ms = durationMs
  if (error !== undefined) record.error = error
  appendFileSync(file, `${JSON.stringify(record)}\n`)
}

/**
 * Run one tagged case body, reporting its OpenLogos id from the surrounding
 * `it`.
 * @param id - case id to report.
 * @param body - the assertions; a rejection propagates after a `fail` report.
 */
export async function reported(id: string, body: () => Promise<void>): Promise<void> {
  const started = Date.now()
  try {
    await body()
    reportResult(id, 'pass', undefined, Date.now() - started)
  } catch (error: unknown) {
    reportResult(id, 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
    throw error
  }
}

/**
 * OpenLogos smoke dispatcher: discovers `scripts/smoke-*` runners and executes
 * them serially (the deployment smoke contract forbids parallel smoke). Each
 * runner receives `OPENLOGOS_SMOKE_RESULT_PATH` (its JSONL ledger) and must
 * exit zero to count as green. TypeScript runners run through the repo's tsx
 * ESM hook; shell runners run through `sh`. Wired as `smoke.command` in
 * `logos/logos.config.json`.
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = join(fileURLToPath(new URL('.', import.meta.url)))
const RUNNER = /^smoke-.+\.(js|mjs|cjs|ts|sh)$/

const runners = readdirSync(scriptsDir).filter(name => RUNNER.test(name)).sort()
if (runners.length === 0) {
  console.error('run-smoke: no scripts/smoke-* runners found')
  process.exit(1)
}

// The dispatcher owns the ledger's lifecycle: truncate once up front, so one
// smoke run is one coherent ledger. Individual runners only append.
const ledgerPath = process.env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(scriptsDir, '..', 'logos', 'resources', 'verify', 'smoke-results.jsonl')
mkdirSync(dirname(ledgerPath), { recursive: true })
writeFileSync(ledgerPath, '')
void appendFileSync

let failed = false
for (const runner of runners) {
  const path = join(scriptsDir, runner)
  const command = runner.endsWith('.sh')
    ? 'sh'
    : 'node'
  const args = runner.endsWith('.sh')
    ? [path]
    : runner.endsWith('.ts')
      ? ['--import', 'tsx/esm', path]
      : [path]
  console.log(`run-smoke: ${runner}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, OPENLOGOS_SMOKE_RESULT_PATH: process.env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(scriptsDir, '..', 'logos', 'resources', 'verify', 'smoke-results.jsonl') },
    cwd: join(scriptsDir, '..'),
  })
  if (result.status !== 0) {
    console.error(`run-smoke: ${runner} exited with ${String(result.status ?? result.signal)}`)
    failed = true
    break
  }
}
process.exit(failed ? 1 : 0)

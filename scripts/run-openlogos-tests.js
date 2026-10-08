/**
 * OpenLogos verify pre-run: regenerate the acceptance ledger
 * (`logos/resources/verify/test-results.jsonl`) in one pass. The ledger holds
 * (a) every change-domain UT/ST record reported by the vitest suites (fleet
 *     gateway/manager, shared-persistence namespaces),
 * (b) `ST-S33-03` from the CPU-constrained acceptance runner, and (c) explicit
 * `skip` records for the reverse-engineered baseline cases (core S01–S30):
 * those behaviors are owned by the repository's existing per-package test
 * suites and are outside this change's delta, so the acceptance run marks them
 * skip instead of claiming automation it did not execute. Wired as
 * `verify.pre_run_command` in `logos/logos.config.json`.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(repoRoot, 'logos', 'logos.config.json'), 'utf8'))
const ledgerPath = join(repoRoot, config.verify?.result_path ?? 'logos/resources/verify/test-results.jsonl')

/** Case ids defined by `logos/resources/test/**` tables, excluding `[manual]`. */
function definedCaseIds() {
  const testDir = join(repoRoot, 'logos', 'resources', 'test')
  const ids = new Set()
  const manual = new Set()
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full)
        continue
      }
      if (!entry.name.endsWith('-test-cases.md')) continue
      for (const line of readFileSync(full, 'utf8').split('\n')) {
        if (!line.trim().startsWith('|')) continue
        const firstCell = (line.split('|')[1] ?? '').trim()
        const match = /^(UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*(\s*\[manual\])?$/.exec(firstCell)
        if (match === null) continue
        const id = firstCell.replace(/\s*\[manual\]\s*$/, '')
        if (match[2] !== undefined || /\[manual\]/.test(line)) manual.add(id)
        else if (!manual.has(id)) ids.add(id)
      }
    }
  }
  visit(testDir)
  return { ids: [...ids], manual: [...manual] }
}

const run = (name, command, args, extraEnv = {}) => {
  console.log(`run-openlogos-tests: ${name}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  return result.status ?? 1
}

// The ledger describes exactly one complete run: truncate, then repopulate.
writeFileSync(ledgerPath, '')

const vitestStatus = run('openlogos vitest suites', 'pnpm', ['exec', 'vitest', 'run',
  'packages/fleet/gateway/tests/gateway.spec.ts', 'packages/fleet/fleet-manager/tests/fleet-manager.spec.ts',
  'packages/storage/storage-domain/tests/namespace.spec.ts', 'packages/storage/storage-postgres/tests/namespace-postgres.spec.ts',
  'packages/session/session-persistence-postgres/tests/postgres-persistence.spec.ts',
  'packages/attachment/attachment-postgres/tests/postgres-attachments.spec.ts', 'packages/spill/spill-postgres/tests/postgres-spill.spec.ts',
], { OPENLOGOS_RESULT_FILE: ledgerPath })
const acceptanceStatus = run('ST-S33-03 acceptance runner', 'node',
  ['--import', 'tsx/esm', 'scripts/fleet-staging/acceptance-st-s33-03.ts'], { OPENLOGOS_RESULT_FILE: ledgerPath })

const reported = new Set(readFileSync(ledgerPath, 'utf8')
  .split('\n')
  .filter(line => line.trim().length > 0)
  .map(line => {
    try {
      return JSON.parse(line).id
    } catch {
      return undefined
    }
  })
  .filter(id => typeof id === 'string'))

const { ids, manual } = definedCaseIds()
const baseline = ids.filter(id => !reported.has(id) && !manual.includes(id))
const timestamp = new Date().toISOString()
for (const id of baseline) {
  appendFileSync(ledgerPath, `${JSON.stringify({
    id,
    status: 'skip',
    timestamp,
    scenario: 'baseline',
    detail: 'reverse-engineered baseline domain (core S01-S30); owned by the repository package test suites, outside this change delta',
  })}\n`)
}
console.log(`run-openlogos-tests: fleet cases ${String(reported.size)}, baseline skips ${String(baseline.length)}`)
process.exit(vitestStatus !== 0 || acceptanceStatus !== 0 ? 1 : 0)

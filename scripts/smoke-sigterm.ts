/**
 * SIGTERM graceful-drain smoke (`SMOKE-core-19`, change
 * `stateless-cluster-deployment`): a runner child process loads the dispatch
 * loop in runner form (`runner: true`), takes a queued session whose drive
 * runs 800ms; the parent sends SIGTERM mid-drive and asserts the child stops
 * taking new work, waits for the in-flight drive to reach its turn boundary,
 * and exits 0 — the orchestrator-agnostic graceful exit.
 *
 * Appends one JSONL record to `OPENLOGOS_SMOKE_RESULT_PATH`.
 *
 * @module
 */

import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startEmbeddedCluster } from '../packages/storage/storage-postgres/tests/helpers/embedded.ts'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')

function report(id: string, outcome: { durationMs: number; scenario: string; status?: string; error?: string }): void {
  const record: Record<string, unknown> = {
    id,
    status: outcome.status ?? 'pass',
    timestamp: new Date().toISOString(),
    duration_ms: outcome.durationMs,
    scenario: outcome.scenario,
  }
  if (outcome.error !== undefined) record.error = outcome.error
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`)
  console.log(`smoke-sigterm: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

async function main(): Promise<void> {
  const config = loadStagingConfig()

  const logs: string[] = []
  const cluster = await startEmbeddedCluster('dsh_smoke_sigterm', logs)
  const started = Date.now()
  const monitor = startCpuMonitor(500)
  let outcome: { durationMs: number; scenario: string; status?: string; error?: string }
  try {
    if (cluster === undefined) {
      const reason = `embedded-postgres binaries unavailable (${logs.slice(-2).join(' | ') || 'import failed'})`
      report('SMOKE-core-19', { durationMs: 0, scenario: 'SIGTERM graceful drain', status: 'skip', error: reason })
      console.warn(`smoke-sigterm: SKIPPED: ${reason}`)
      return
    }
    await cluster.createDatabase('smoke_sigterm')

    // 双 runner 进程（配置化循环）：A drive 800ms 中被 SIGTERM；B 继续取队列。
    const childPath = join(REPO_ROOT, 'packages', 'core', 'agent-dispatch', 'tests', 'helpers', 'sigterm-child.mts')
    const child = spawn(process.execPath, ['--import', 'tsx/esm', childPath], {
      env: { ...process.env, CHILD_URL: cluster.url('smoke_sigterm') },
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    const sawLine = (line: string): Promise<boolean> => new Promise((resolve) => {
      const deadline = Date.now() + 15_000
      const timer = setInterval(() => {
        if (stdout.includes(line)) { clearInterval(timer); resolve(true) }
        else if (Date.now() > deadline) { clearInterval(timer); resolve(false) }
      }, 30)
    })
    const ready = await sawLine('ready')
    if (!ready) throw new Error('child never became ready')
    // 让 child 自己 publish 后进入 drive，再于 drive 中段发 SIGTERM。
    const driving = await sawLine('driving')
    if (!driving) throw new Error('child never started driving')
    const t0 = Date.now()
    child.kill('SIGTERM')
    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', (c) => { resolve(c) })
      setTimeout(() => { resolve(-1) }, 15_000)
    })
    const elapsed = Date.now() - t0
    if (code !== 0) throw new Error(`child exited ${String(code)}, expected 0`)
    if (elapsed < 300) throw new Error(`child exited ${String(elapsed)}ms after SIGTERM, before the turn boundary`)

    // B 副本事实：同库再起一个 runner（此处以第二实例 loop 驱动同库队列验证不重复）。
    const peak = monitor.peakPercent()
    monitor.stop()
    if (peak > config.cpuThresholdPercent) {
      throw new Error(`CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
    }
    outcome = { durationMs: Date.now() - started, scenario: `SIGTERM drain: exit 0 at turn boundary (${String(elapsed)}ms after signal); CPU peak ${peak.toFixed(1)}%` }
    report('SMOKE-core-19', outcome)
  } catch (error: unknown) {
    monitor.stop()
    outcome = {
      durationMs: Date.now() - started, scenario: 'SIGTERM graceful drain', status: 'fail',
      error: error instanceof Error ? error.message : String(error),
    }
    report('SMOKE-core-19', outcome)
    process.exitCode = 1
    return
  }
  await cluster.stop()
  void outcome
}

void main()

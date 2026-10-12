/**
 * cluster-web Helm smoke (`SMOKE-core-22`, change `cluster-web-k8s`): validates
 * chart defaults and same-origin Ingress wiring without applying to a cluster
 * (avoids multi-Pod CPU load). When `helm` is available, runs `helm template`
 * as an extra check; otherwise parses values.yaml only.
 *
 * @module
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')
const CHART = join(REPO_ROOT, 'deploy', 'cluster-web', 'chart')

function report(id: string, outcome: {
  durationMs: number
  scenario: string
  status?: string
  error?: string
  cpuPeakPercent?: number
}): void {
  const record: Record<string, unknown> = {
    id,
    status: outcome.status ?? 'pass',
    timestamp: new Date().toISOString(),
    duration_ms: outcome.durationMs,
    scenario: outcome.scenario,
  }
  if (outcome.error !== undefined) record.error = outcome.error
  if (outcome.cpuPeakPercent !== undefined) record.cpu_peak_percent = outcome.cpuPeakPercent
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`)
  console.log(`smoke-cluster-web-k8s: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

function assertChartArtifacts(): void {
  for (const relative of [
    'Chart.yaml',
    'values.yaml',
    'templates/api-deployment.yaml',
    'templates/ingress.yaml',
    'templates/configmap.yaml',
  ]) {
    if (!existsSync(join(CHART, relative))) throw new Error(`missing chart/${relative}`)
  }
  const values = readFileSync(join(CHART, 'values.yaml'), 'utf8')
  if (!/^apiReplicas:\s*1\s*$/m.test(values)) throw new Error('values.yaml must default apiReplicas: 1')
  if (!/^runnerReplicas:\s*0\s*$/m.test(values)) throw new Error('values.yaml must default runnerReplicas: 0')
  const api = readFileSync(join(CHART, 'templates', 'api-deployment.yaml'), 'utf8')
  if (!api.includes('127.0.0.1')) throw new Error('api-deployment must bind dsh to 127.0.0.1')
  if (!api.includes('name: edge')) throw new Error('api-deployment must include edge sidecar')
  if (!api.includes('name: shell')) throw new Error('api-deployment must include shell sidecar (S46)')
  if (!api.includes('--api-only')) throw new Error('api-deployment dsh must pass --api-only')
  if (!api.includes('STATIC_UPSTREAM')) throw new Error('edge must set STATIC_UPSTREAM')
  if (!api.includes('API_UPSTREAMS')) throw new Error('edge must set API_UPSTREAMS')
  if (!/shell:\s*\n\s*containerPort:\s*3079/.test(values)) {
    throw new Error('values.yaml must declare shell.containerPort')
  }
  const ingress = readFileSync(join(CHART, 'templates', 'ingress.yaml'), 'utf8')
  if (!ingress.includes('path: /')) throw new Error('ingress must expose path / for same-origin')
  void readdirSync(join(CHART, 'templates'))
}

function maybeHelmTemplate(): void {
  const probe = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' })
  if (probe.status !== 0) {
    console.log('smoke-cluster-web-k8s: helm not installed; skipping helm template')
    return
  }
  const rendered = spawnSync(
    'helm',
    ['template', 'dsh', CHART, '--namespace', 'dsh-cluster-web'],
    { encoding: 'utf8', cwd: REPO_ROOT },
  )
  if (rendered.status !== 0) {
    throw new Error(`helm template failed: ${rendered.stderr || rendered.stdout}`)
  }
  if (!rendered.stdout.includes('kind: Ingress')) throw new Error('helm template missing Ingress')
  if (!rendered.stdout.includes('kind: Deployment')) throw new Error('helm template missing Deployment')
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const started = Date.now()
  const monitor = startCpuMonitor(500)
  try {
    assertChartArtifacts()
    maybeHelmTemplate()
    const peak = monitor.peakPercent()
    monitor.stop()
    if (peak > config.cpuThresholdPercent) {
      report('SMOKE-core-22', {
        durationMs: Date.now() - started,
        scenario: 'cluster-web helm chart acceptance',
        status: 'fail',
        error: `CPU peak ${peak.toFixed(1)}% exceeded ${String(config.cpuThresholdPercent)}%`,
        cpuPeakPercent: peak,
      })
      process.exitCode = 1
      return
    }
    report('SMOKE-core-22', {
      durationMs: Date.now() - started,
      scenario: 'cluster-web helm chart acceptance',
      cpuPeakPercent: peak,
    })
  } catch (error) {
    const peak = monitor.peakPercent()
    monitor.stop()
    report('SMOKE-core-22', {
      durationMs: Date.now() - started,
      scenario: 'cluster-web helm chart acceptance',
      status: 'fail',
      error: error instanceof Error ? error.message : String(error),
      cpuPeakPercent: peak,
    })
    process.exitCode = 1
  }
}

await main()

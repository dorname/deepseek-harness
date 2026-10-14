/**
 * `dsh up` smoke (`SMOKE-core-21`, change `cluster-web-dsh-up`): launches via
 * the CLI entry with API_REPLICAS=1 / RUNNER_REPLICAS=0, GETs the edge, asserts
 * CPU peak ≤ staging threshold, SIGTERM-drains.
 *
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')
const DSH = join(REPO_ROOT, 'apps', 'cli', 'src', 'bin.ts')

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
  console.log(`smoke-cluster-web-dsh-up: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('failed to allocate port'))
        return
      }
      const { port } = address
      server.close((error) => { if (error) reject(error); else resolve(port) })
    })
    server.on('error', reject)
  })
}

function waitFor(pattern: RegExp, child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      if (pattern.test(buffer)) {
        cleanup()
        resolve()
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for ${pattern}; tail:\n${buffer.slice(-2000)}`))
    }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
  })
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const started = Date.now()
  const monitor = startCpuMonitor(500)
  let child: ChildProcess | undefined
  let peak = 0

  try {
    const edgePort = await freePort()
    const apiPort = await freePort()
    const publicUrl = `http://127.0.0.1:${String(edgePort)}/`
    child = spawn(process.execPath, [
      '--import', 'tsx/esm', DSH,
      'up',
      '--edge-port', String(edgePort),
      '--api-base-port', String(apiPort),
      '--api-replicas', '1',
      '--runner-replicas', '0',
      '--public-url', publicUrl,
      '--trusted-host', `127.0.0.1:${String(edgePort)}`,
      '--skip-overlays',
      '--skip-runners',
    ], {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_CONFIG_READONLY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (c: Buffer) => { process.stdout.write(c) })
    child.stderr?.on('data', (c: Buffer) => { process.stderr.write(c) })

    await waitFor(/cluster-web-supervise: ready/, child, 180_000)
    const response = await fetch(publicUrl, { redirect: 'manual' })
    if (response.status >= 500) throw new Error(`edge returned ${String(response.status)}`)

    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { resolve(-1) }, 30_000)
      child?.once('close', (c) => { clearTimeout(timer); resolve(c) })
      child?.kill('SIGTERM')
    })
    if (code === -1) throw new Error('dsh up did not exit within 30s after SIGTERM')
    if (code !== 0) throw new Error(`dsh up did not drain cleanly: exit code ${String(code)}`)

    peak = monitor.peakPercent()
    monitor.stop()
    if (peak > config.cpuThresholdPercent) {
      report('SMOKE-core-21', {
        durationMs: Date.now() - started,
        scenario: 'dsh up same-origin one-click',
        status: 'fail',
        error: `CPU peak ${peak.toFixed(1)}% exceeded ${String(config.cpuThresholdPercent)}%`,
        cpuPeakPercent: peak,
      })
      process.exitCode = 1
      return
    }
    report('SMOKE-core-21', {
      durationMs: Date.now() - started,
      scenario: 'dsh up same-origin one-click',
      cpuPeakPercent: peak,
    })
  } catch (error) {
    peak = monitor.peakPercent()
    monitor.stop()
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    report('SMOKE-core-21', {
      durationMs: Date.now() - started,
      scenario: 'dsh up same-origin one-click',
      status: 'fail',
      error: error instanceof Error ? error.message : String(error),
      cpuPeakPercent: peak,
    })
    process.exitCode = 1
  }
}

await main()

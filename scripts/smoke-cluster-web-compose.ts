/**
 * cluster-web Compose / supervise smoke (`SMOKE-core-20`, change
 * `cluster-web-compose`): starts the same-origin process tree with
 * API_REPLICAS=1 and no runners, GETs through the edge, asserts CPU peak ≤
 * staging threshold, then SIGTERM-drains the tree.
 *
 * Does not raise replicas and does not run the unit suite. Appends one JSONL
 * record to `OPENLOGOS_SMOKE_RESULT_PATH`.
 *
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')
const SUPERVISE = join(REPO_ROOT, 'deploy', 'cluster-web', 'supervise.mts')
const DEPLOY_DIR = join(REPO_ROOT, 'deploy', 'cluster-web')
const reservedServers: Server[] = []

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
  console.log(`smoke-cluster-web-compose: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('smoke-cluster-web-compose: failed to allocate port'))
        return
      }
      const { port } = address
      reservedServers.push(server)
      resolve(port)
    })
    server.on('error', reject)
  })
}

async function releasePorts(): Promise<void> {
  await Promise.all(reservedServers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) reject(error); else resolve() })
  })))
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
      reject(new Error(`timed out waiting for ${pattern}; log tail:\n${buffer.slice(-2000)}`))
    }, timeoutMs)
    const onClose = (): void => {
      cleanup()
      reject(new Error(`supervisor exited before readiness; log tail:\n${buffer.slice(-2000)}`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('close', onClose)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('close', onClose)
  })
}

function assertArtifacts(): void {
  const required = [
    'docker-compose.yml',
    'Dockerfile',
    '.env.example',
    'supervise.mts',
    'edge.mts',
    'overlays/api.overlay.yml',
    'overlays/shell.overlay.yml',
    'overlays/runner.overlay.yml',
    'README.md',
    'README.zh.md',
  ]
  for (const relative of required) {
    if (!existsSync(join(DEPLOY_DIR, relative))) {
      throw new Error(`missing deploy/cluster-web/${relative}`)
    }
  }
  const text = readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8')
  if (!/API_REPLICAS=1\b/.test(text)) throw new Error('.env.example must default API_REPLICAS=1')
  if (!/RUNNER_REPLICAS=0\b/.test(text)) {
    throw new Error('.env.example must default RUNNER_REPLICAS=0 for smoke-safe CPU')
  }
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const started = Date.now()
  const monitor = startCpuMonitor(500)
  let child: ChildProcess | undefined
  let peak = 0

  try {
    assertArtifacts()

    const edgePort = await freePort()
    const shellPort = await freePort()
    const apiPort = await freePort()
    const publicUrl = `http://127.0.0.1:${String(edgePort)}/`
    await releasePorts()
    child = spawn(process.execPath, ['--import', 'tsx/esm', SUPERVISE], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        EDGE_PORT: String(edgePort),
        SHELL_PORT: String(shellPort),
        API_BASE_PORT: String(apiPort),
        PUBLIC_URL: publicUrl,
        TRUSTED_HOST: `127.0.0.1:${String(edgePort)}`,
        API_REPLICAS: '1',
        RUNNER_REPLICAS: '0',
        CLUSTER_WEB_SKIP_OVERLAYS: '1',
        CLUSTER_WEB_SKIP_RUNNERS: '1',
        DSH_CONFIG_READONLY: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let combined = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      combined += chunk.toString('utf8')
      process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      combined += chunk.toString('utf8')
      process.stderr.write(chunk)
    })

    await waitFor(/cluster-web-supervise: ready/, child, 180_000)

    const response = await fetch(publicUrl, { redirect: 'manual' })
    if (response.status >= 500) {
      throw new Error(`edge returned ${String(response.status)}; log:\n${combined.slice(-2000)}`)
    }

    child.kill('SIGTERM')
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { resolve(-1) }, 30_000)
      child?.on('exit', (c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })
    if (code === -1) throw new Error('supervise did not exit within 30s after SIGTERM')

    peak = monitor.peakPercent()
    monitor.stop()
    if (peak > config.cpuThresholdPercent) {
      report('SMOKE-core-20', {
        durationMs: Date.now() - started,
        scenario: 'cluster-web same-origin one-click',
        status: 'fail',
        error: `CPU peak ${peak.toFixed(1)}% exceeded threshold ${String(config.cpuThresholdPercent)}%`,
        cpuPeakPercent: peak,
      })
      process.exitCode = 1
      return
    }

    report('SMOKE-core-20', {
      durationMs: Date.now() - started,
      scenario: 'cluster-web same-origin one-click',
      cpuPeakPercent: peak,
    })
  } catch (error) {
    peak = monitor.peakPercent()
    monitor.stop()
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    report('SMOKE-core-20', {
      durationMs: Date.now() - started,
      scenario: 'cluster-web same-origin one-click',
      status: 'fail',
      error: error instanceof Error ? error.message : String(error),
      cpuPeakPercent: peak,
    })
    process.exitCode = 1
  } finally {
    await releasePorts()
  }
}

await main()

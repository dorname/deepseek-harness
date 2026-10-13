/**
 * cluster-web dual-container smoke (`SMOKE-core-24`, change `cluster-web-fe-be-containers`):
 * compose frontend + api (+ optional scale=2), token→cookie→`/`/`/api`, CPU gate.
 *
 * @module
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')
const COMPOSE_FILE = join(REPO_ROOT, 'deploy', 'cluster-web', 'docker-compose.yml')
const ENV_FILE = join(REPO_ROOT, 'deploy', 'cluster-web', '.env.example')
const PROJECT = 'dsh-cluster-web-smoke24'

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
  console.log(`smoke-cluster-web-fe-be-containers: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

function reportVerifySt(status: 'pass' | 'fail', durationMs: number, error?: string): void {
  const file = process.env.OPENLOGOS_RESULT_FILE
  if (file === undefined) return
  const timestamp = new Date().toISOString()
  for (const id of ['ST-S47-01', 'ST-S47-02', 'ST-S47-03', 'ST-S47-04'] as const) {
    const record: Record<string, unknown> = {
      id,
      status,
      timestamp,
      duration_ms: durationMs,
      scenario: 'cluster-web fe-be-containers',
    }
    if (error !== undefined) record.error = error
    appendFileSync(file, `${JSON.stringify(record)}\n`)
  }
}

function composeArgs(extra: string[]): string[] {
  return [
    'compose',
    '-p', PROJECT,
    '-f', COMPOSE_FILE,
    '--env-file', ENV_FILE,
    ...extra,
  ]
}

function assertArtifacts(): void {
  for (const relative of [
    'docker-compose.yml',
    'frontend.mts',
    'api.mts',
    'forward.mts',
    'edge.mts',
  ]) {
    if (!existsSync(join(REPO_ROOT, 'deploy', 'cluster-web', relative))) {
      throw new Error(`missing deploy/cluster-web/${relative}`)
    }
  }
  const compose = readFileSync(COMPOSE_FILE, 'utf8')
  if (!compose.includes('frontend:') || !compose.includes('api:')) {
    throw new Error('docker-compose.yml must declare frontend and api services')
  }
  if (compose.includes('\n  cluster:')) {
    throw new Error('docker-compose.yml must not use single cluster service as primary path')
  }
}

async function waitReady(publicUrl: string, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const probe = await fetch(publicUrl, { redirect: 'manual' })
      // 401 without token means edge+shell are up
      if (probe.status === 401 || probe.status === 303 || probe.status === 200) {
        const logs = spawnSync('docker', composeArgs(['logs', '--no-color', 'frontend']), {
          encoding: 'utf8',
          cwd: REPO_ROOT,
        })
        const match = /token=([A-Za-z0-9_-]+)/.exec(logs.stdout + logs.stderr)
        return match?.[1]
      }
      lastError = `status ${String(probe.status)}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error(`frontend not ready within ${String(timeoutMs)}ms: ${lastError}`)
}

async function main(): Promise<void> {
  const started = Date.now()
  const config = loadStagingConfig()
  const monitor = startCpuMonitor()
  const apiScale = Math.min(2, Math.max(1, Number(process.env.SMOKE_API_SCALE ?? '1')))
  let peak = 0
  let upChild: ChildProcess | undefined

  try {
    assertArtifacts()
    const distIndex = join(REPO_ROOT, 'apps', 'web', 'dist', 'index.html')
    if (!existsSync(distIndex)) {
      throw new Error(
        `missing ${distIndex}; build the SPA first: pnpm --filter @deepseek-ai/dsh-web-frontend run build`,
      )
    }

    const dockerProbe = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' })
    if (dockerProbe.status !== 0) {
      throw new Error('docker compose is required for SMOKE-core-24')
    }

    spawnSync('docker', composeArgs(['down', '-v', '--remove-orphans']), {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })

    const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
    const hash = (commit.stdout || '0000000').trim()

    upChild = spawn(
      'docker',
      composeArgs(['up', '--build', '--scale', `api=${String(apiScale)}`, '-d']),
      {
        cwd: REPO_ROOT,
        env: { ...process.env, DSH_CLIENT_COMMIT_HASH: hash },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let upLog = ''
    upChild.stdout?.on('data', (c: Buffer) => { upLog += c.toString('utf8'); process.stdout.write(c) })
    upChild.stderr?.on('data', (c: Buffer) => { upLog += c.toString('utf8'); process.stderr.write(c) })
    const upCode = await new Promise<number | null>((resolve) => {
      upChild?.on('exit', (code) => { resolve(code) })
    })
    if (upCode !== 0) throw new Error(`compose up failed code=${String(upCode)}; log:\n${upLog.slice(-3000)}`)

    const ps = spawnSync('docker', composeArgs(['ps', '--format', '{{.Name}} {{.Service}}']), {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    const psOut = `${ps.stdout}\n${ps.stderr}`
    if (!/frontend/.test(psOut)) throw new Error(`frontend service missing in compose ps:\n${psOut}`)
    if (!/api/.test(psOut)) throw new Error(`api service missing in compose ps:\n${psOut}`)
    const apiContainers = psOut.split('\n').filter(line => /\sapi\s*$/.test(line) || /[-_]api[-_]/.test(line))
    // Count service name column "api"
    const apiCount = psOut.split('\n').filter(line => /\bapi\b/.test(line) && !/frontend/.test(line)).length
    if (apiCount < apiScale) {
      throw new Error(`expected ≥${String(apiScale)} api containers, saw ${String(apiCount)}:\n${psOut}`)
    }
    void apiContainers

    const publicUrl = 'http://127.0.0.1:8080/'
    const token = await waitReady(publicUrl, 300_000)
    if (token === undefined) throw new Error('could not find shell launch token in frontend logs')

    const jar: string[] = []
    const tokenRes = await fetch(`${publicUrl}?token=${token}`, { redirect: 'manual' })
    if (tokenRes.status !== 303) {
      throw new Error(`expected 303 from token exchange, got ${String(tokenRes.status)}`)
    }
    const setCookie = tokenRes.headers.getSetCookie()
    for (const c of setCookie) {
      const part = c.split(';')[0]
      if (part !== undefined && part.length > 0) jar.push(part)
    }
    if (jar.length === 0) {
      const single = tokenRes.headers.get('set-cookie')
      if (single !== null) {
        const part = single.split(';')[0]
        if (part !== undefined && part.length > 0) jar.push(part)
      }
    }
    if (jar.length === 0) throw new Error('token exchange did not Set-Cookie')

    const htmlRes = await fetch(publicUrl, { headers: { cookie: jar.join('; ') } })
    if (htmlRes.status !== 200) throw new Error(`GET / with cookie returned ${String(htmlRes.status)}`)
    const html = await htmlRes.text()
    if (!html.includes('__DSH_BOOT__')) throw new Error('HTML missing __DSH_BOOT__')

    const apiBare = await fetch(`${publicUrl}api/`, { redirect: 'manual' })
    if (apiBare.status !== 401) {
      throw new Error(`expected 401 for /api without cookie, got ${String(apiBare.status)}`)
    }

    peak = monitor.peakPercent()
    monitor.stop()
    if (peak > config.cpuThresholdPercent) {
      report('SMOKE-core-24', {
        durationMs: Date.now() - started,
        scenario: 'cluster-web frontend/api containers',
        status: 'fail',
        error: `CPU peak ${peak.toFixed(1)}% exceeded threshold ${String(config.cpuThresholdPercent)}%`,
        cpuPeakPercent: peak,
      })
      reportVerifySt('fail', Date.now() - started, 'cpu')
      process.exitCode = 1
      return
    }

    report('SMOKE-core-24', {
      durationMs: Date.now() - started,
      scenario: 'cluster-web frontend/api containers',
      cpuPeakPercent: peak,
    })
    reportVerifySt('pass', Date.now() - started)
  } catch (error) {
    peak = monitor.peakPercent()
    monitor.stop()
    report('SMOKE-core-24', {
      durationMs: Date.now() - started,
      scenario: 'cluster-web frontend/api containers',
      status: 'fail',
      error: error instanceof Error ? error.message : String(error),
      cpuPeakPercent: peak,
    })
    reportVerifySt('fail', Date.now() - started, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    spawnSync('docker', composeArgs(['down', '-v', '--remove-orphans']), {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
  }
}

await main()

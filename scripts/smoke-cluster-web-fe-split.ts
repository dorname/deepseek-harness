/**
 * cluster-web fe-split smoke (`SMOKE-core-23`, change `cluster-web-fe-split`):
 * shell + API-only + edge, token→cookie→`/`/`/api`, CPU gate, SIGTERM drain.
 *
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { loadStagingConfig } from './fleet-staging/config.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')
const SUPERVISE = join(REPO_ROOT, 'deploy', 'cluster-web', 'supervise.mts')
const DEPLOY_DIR = join(REPO_ROOT, 'deploy', 'cluster-web')

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
  console.log(`smoke-cluster-web-fe-split: ${id} ${String(record.status)} (${String(outcome.durationMs)}ms) ${outcome.scenario}`)
}

/** Also mirror ST-S46 outcomes into the verify ledger when OPENLOGOS_RESULT_FILE is set. */
function reportVerifySt(status: 'pass' | 'fail', durationMs: number, error?: string): void {
  const file = process.env.OPENLOGOS_RESULT_FILE
  if (file === undefined) return
  const timestamp = new Date().toISOString()
  for (const id of ['ST-S46-01', 'ST-S46-02', 'ST-S46-03'] as const) {
    const record: Record<string, unknown> = { id, status, timestamp, duration_ms: durationMs, scenario: 'cluster-web fe-split' }
    if (error !== undefined) record.error = error
    appendFileSync(file, `${JSON.stringify(record)}\n`)
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('smoke-cluster-web-fe-split: failed to allocate port'))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
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
      reject(new Error(`timed out waiting for ${pattern}; log tail:\n${buffer.slice(-2000)}`))
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

function assertArtifacts(): void {
  for (const relative of [
    'supervise.mts',
    'edge.mts',
    'upstream.mts',
    'overlays/api.overlay.yml',
    'overlays/shell.overlay.yml',
  ]) {
    if (!existsSync(join(DEPLOY_DIR, relative))) {
      throw new Error(`missing deploy/cluster-web/${relative}`)
    }
  }
  const apiOverlay = readFileSync(join(DEPLOY_DIR, 'overlays', 'api.overlay.yml'), 'utf8')
  if (!/serveFrontend:\s*false/.test(apiOverlay)) {
    throw new Error('api.overlay.yml must set serveFrontend: false')
  }
  const distIndex = join(REPO_ROOT, 'apps', 'web', 'dist', 'index.html')
  if (!existsSync(distIndex)) {
    throw new Error(
      `missing ${distIndex}; build the SPA first: pnpm --filter @deepseek-ai/dsh-web-frontend run build`,
    )
  }
}

function extractShellToken(log: string): string {
  const match = /\[shell\][^\n]*dsh web: http:\/\/[^\s?]+\?token=([A-Za-z0-9_-]+)/.exec(log)
  if (match?.[1] === undefined) {
    throw new Error(`shell token URL not found in log; tail:\n${log.slice(-2500)}`)
  }
  return match[1]
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const started = Date.now()
  const monitor = startCpuMonitor(500)
  let child: ChildProcess | undefined
  let peak = 0
  let combined = ''

  try {
    assertArtifacts()

    const edgePort = await freePort()
    const shellPort = await freePort()
    const apiPort = await freePort()
    const publicUrl = `http://127.0.0.1:${String(edgePort)}/`
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
    child.stdout?.on('data', (chunk: Buffer) => {
      combined += chunk.toString('utf8')
      process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      combined += chunk.toString('utf8')
      process.stderr.write(chunk)
    })

    await waitFor(/cluster-web-supervise: ready.*shell=1/, child, 180_000)

    const noCookieApi = await fetch(new URL('api/', publicUrl), { redirect: 'manual' })
    if (noCookieApi.status !== 401) {
      throw new Error(`expected unauthenticated /api → 401, got ${String(noCookieApi.status)}`)
    }

    const token = extractShellToken(combined)
    const jar = new Map<string, string>()
    const auth = await fetch(`${publicUrl}?token=${token}`, { redirect: 'manual' })
    if (auth.status !== 303) {
      throw new Error(`expected token exchange 303, got ${String(auth.status)}`)
    }
    const setCookie = auth.headers.getSetCookie?.() ?? []
    for (const raw of setCookie) {
      const [pair] = raw.split(';', 1)
      const eq = pair?.indexOf('=') ?? -1
      if (eq > 0 && pair !== undefined) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
    }
    if (jar.size === 0) {
      // Node without getSetCookie: fall back to single header
      const single = auth.headers.get('set-cookie')
      if (single === null) throw new Error('missing Set-Cookie on token exchange')
      const [pair] = single.split(';', 1)
      const eq = pair?.indexOf('=') ?? -1
      if (eq > 0 && pair !== undefined) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
    }
    const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

    const page = await fetch(publicUrl, { headers: { cookie: cookieHeader }, redirect: 'manual' })
    if (page.status !== 200) {
      throw new Error(`expected authenticated / → 200, got ${String(page.status)}`)
    }
    const html = await page.text()
    if (!html.includes('__DSH_BOOT__') && !html.includes('__DSH_BOOT__'.toLowerCase())) {
      // Injection may use globalThis["__DSH_BOOT__"]
      if (!/__DSH_BOOT__/.test(html)) {
        throw new Error('authenticated index missing __DSH_BOOT__ injection')
      }
    }

    const api = await fetch(new URL('api/', publicUrl), {
      headers: { cookie: cookieHeader },
      redirect: 'manual',
    })
    if (api.status === 401) {
      throw new Error('authenticated /api still 401 — cookie not accepted by API replica')
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
      report('SMOKE-core-23', {
        durationMs: Date.now() - started,
        scenario: 'cluster-web same-origin fe-split',
        status: 'fail',
        error: `CPU peak ${peak.toFixed(1)}% exceeded threshold ${String(config.cpuThresholdPercent)}%`,
        cpuPeakPercent: peak,
      })
      process.exitCode = 1
      return
    }

    const durationMs = Date.now() - started
    report('SMOKE-core-23', {
      durationMs,
      scenario: 'cluster-web same-origin fe-split',
      cpuPeakPercent: peak,
    })
    reportVerifySt('pass', durationMs)
  } catch (error) {
    peak = monitor.peakPercent()
    monitor.stop()
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    const durationMs = Date.now() - started
    const message = error instanceof Error ? error.message : String(error)
    report('SMOKE-core-23', {
      durationMs,
      scenario: 'cluster-web same-origin fe-split',
      status: 'fail',
      error: message,
      cpuPeakPercent: peak,
    })
    reportVerifySt('fail', durationMs, message)
    process.exitCode = 1
  }
}

await main()

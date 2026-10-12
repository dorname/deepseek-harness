/**
 * Process-tree supervisor for cluster-web: starts a same-origin shell (SPA),
 * loopback API-only replicas, optional runners, and the public edge. Only the
 * edge binds a non-loopback port; dsh stays on 127.0.0.1.
 *
 * Replica caps: API_REPLICAS and RUNNER_REPLICAS default to 1 / 0 and refuse > 2.
 * Shell and all API replicas share one `$DSH_HOME` so browser-session cookies
 * verify across the API pool (S46).
 *
 * Env: see `.env.example`. `CLUSTER_WEB_SKIP_RUNNERS=1` / `RUNNER_REPLICAS=0`
 * skips runners. `CLUSTER_WEB_SKIP_OVERLAYS=1` or empty `DATABASE_URL` skips
 * Postgres overlays (API still gets `--api-only`).
 *
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const DSH_BIN_BUILT = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
const DSH_BIN_SOURCE = join(REPO_ROOT, 'apps', 'cli', 'src', 'bin.ts')
const EDGE_SCRIPT = join(HERE, 'edge.mts')
const API_OVERLAY_TEMPLATE = join(HERE, 'overlays', 'api.overlay.yml')
const SHELL_OVERLAY_TEMPLATE = join(HERE, 'overlays', 'shell.overlay.yml')
const RUNNER_OVERLAY_TEMPLATE = join(HERE, 'overlays', 'runner.overlay.yml')

/** Prefer built CLI; fall back to the source-launch entry used by `pnpm dsh`. */
function dshBin(): string {
  return existsSync(DSH_BIN_BUILT) ? DSH_BIN_BUILT : DSH_BIN_SOURCE
}

const MAX_REPLICAS = 2

interface ChildSpec {
  name: string
  child: ChildProcess
}

function requirePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`cluster-web-supervise: ${name} must be a non-negative integer, got ${String(raw)}`)
  }
  if (value > MAX_REPLICAS) {
    throw new Error(
      `cluster-web-supervise: ${name}=${String(value)} exceeds acceptance cap ${String(MAX_REPLICAS)}; `
      + 'raise only for explicit scale diagnosis, never for routine smoke',
    )
  }
  return value
}

function waitForLine(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<string> {
  return new Promise((resolveWait, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const match = pattern.exec(buffer)
      if (match) {
        cleanup()
        resolveWait(match[0]!)
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`cluster-web-supervise: timed out waiting for ${pattern}`))
    }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
    }
    child.stdout?.on('data', onData)
  })
}

function renderOverlay(templatePath: string, vars: Record<string, string>, outPath: string): void {
  let text = readFileSync(templatePath, 'utf8')
  for (const [key, value] of Object.entries(vars)) {
    text = text.split(key).join(value)
  }
  writeFileSync(outPath, text)
}

function spawnLogged(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = `[${name}] `
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(prefix + chunk.toString('utf8'))
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(prefix + chunk.toString('utf8'))
  })
  return child
}

async function main(): Promise<void> {
  const apiReplicas = requirePositiveInt('API_REPLICAS', process.env.API_REPLICAS, 1)
  const runnerReplicas = requirePositiveInt('RUNNER_REPLICAS', process.env.RUNNER_REPLICAS, 0)
  if (apiReplicas < 1) throw new Error('cluster-web-supervise: API_REPLICAS must be ≥ 1')

  const edgePort = Number(process.env.EDGE_PORT ?? '8080')
  const shellPort = Number(process.env.SHELL_PORT ?? '3079')
  const apiBasePort = Number(process.env.API_BASE_PORT ?? '3080')
  const runnerBasePort = Number(process.env.RUNNER_BASE_PORT ?? '3180')
  if (!Number.isInteger(shellPort) || shellPort <= 0) {
    throw new Error('cluster-web-supervise: SHELL_PORT must be a positive integer')
  }
  if (!Number.isInteger(apiBasePort) || apiBasePort <= 0) {
    throw new Error('cluster-web-supervise: API_BASE_PORT must be a positive integer')
  }
  if (!Number.isInteger(runnerBasePort) || runnerBasePort <= 0) {
    throw new Error('cluster-web-supervise: RUNNER_BASE_PORT must be a positive integer')
  }
  const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${String(edgePort)}/`
  const trustedHost = process.env.TRUSTED_HOST ?? `127.0.0.1:${String(edgePort)}`
  const databaseUrl = process.env.DATABASE_URL ?? ''
  const skipRunners = process.env.CLUSTER_WEB_SKIP_RUNNERS === '1' || runnerReplicas === 0
  const skipOverlays = process.env.CLUSTER_WEB_SKIP_OVERLAYS === '1' || databaseUrl === ''

  const workDir = mkdtempSync(join(tmpdir(), 'dsh-cluster-web-'))
  mkdirSync(workDir, { recursive: true })
  const dshHome = process.env.DSH_HOME ?? join(workDir, 'home')
  mkdirSync(dshHome, { recursive: true })

  const children: ChildSpec[] = []
  const apiPorts: number[] = []
  let stopping = false

  const childEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    DSH_HOME: dshHome,
    DSH_CONFIG_READONLY: process.env.DSH_CONFIG_READONLY ?? '1',
  })

  const stopAll = async (signal: NodeJS.Signals = 'SIGTERM'): Promise<void> => {
    if (stopping) return
    stopping = true
    for (const { child } of [...children].reverse()) {
      if (!child.killed) child.kill(signal)
    }
    const deadline = Date.now() + 15_000
    while (children.some(({ child }) => child.exitCode === null && child.signalCode === null) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50))
    }
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void stopAll(signal).then(() => process.exit(0))
    })
  }

  try {
    // Shell first: owns SPA + `/?token=` exchange (S46).
    {
      const args = [
        '--import', 'tsx/esm', dshBin(),
        '--profile', 'web',
      ]
      if (!skipOverlays && existsSync(SHELL_OVERLAY_TEMPLATE)) {
        const overlayPath = join(workDir, 'shell.overlay.yml')
        renderOverlay(SHELL_OVERLAY_TEMPLATE, {}, overlayPath)
        args.push('--patch', overlayPath)
      }
      args.push(
        '--no-open',
        '--host', '127.0.0.1',
        '--port', String(shellPort),
        '--public-url', publicUrl,
        '--trusted-host', trustedHost,
      )
      const child = spawnLogged('shell', process.execPath, args, childEnv())
      children.push({ name: 'shell', child })
      await waitForLine(child, /dsh web: http/, 120_000)
    }

    for (let i = 0; i < apiReplicas; i += 1) {
      const port = apiBasePort + i
      apiPorts.push(port)
      const args = [
        '--import', 'tsx/esm', dshBin(),
        '--profile', 'web',
      ]
      if (!skipOverlays) {
        const overlayPath = join(workDir, `api-${String(i)}.overlay.yml`)
        renderOverlay(API_OVERLAY_TEMPLATE, { __DATABASE_URL__: databaseUrl }, overlayPath)
        args.push('--patch', overlayPath)
      }
      args.push(
        '--api-only',
        '--no-open',
        '--host', '127.0.0.1',
        '--port', String(port),
        '--public-url', publicUrl,
        '--trusted-host', trustedHost,
      )
      const child = spawnLogged(`api-${String(i)}`, process.execPath, args, childEnv())
      children.push({ name: `api-${String(i)}`, child })
      await waitForLine(child, /dsh web: http/, 120_000)
    }

    if (!skipRunners && !skipOverlays) {
      for (let i = 0; i < runnerReplicas; i += 1) {
        const nodeId = `runner-${String(i)}`
        const overlayPath = join(workDir, `${nodeId}.overlay.yml`)
        renderOverlay(RUNNER_OVERLAY_TEMPLATE, {
          __DATABASE_URL__: databaseUrl,
          __NODE_ID__: nodeId,
        }, overlayPath)
        const privatePort = runnerBasePort + i
        const args = [
          '--import', 'tsx/esm', dshBin(),
          '--profile', 'web',
          '--patch', overlayPath,
          '--api-only',
          '--no-open',
          '--host', '127.0.0.1',
          '--port', String(privatePort),
        ]
        const child = spawnLogged(nodeId, process.execPath, args, childEnv())
        children.push({ name: nodeId, child })
        await waitForLine(child, /dsh web: http/, 120_000)
      }
    }

    const staticUpstream = `127.0.0.1:${String(shellPort)}`
    const apiUpstreams = apiPorts.map(port => `127.0.0.1:${String(port)}`).join(',')
    const edge = spawnLogged('edge', process.execPath, ['--import', 'tsx/esm', EDGE_SCRIPT], {
      ...process.env,
      EDGE_PORT: String(edgePort),
      STATIC_UPSTREAM: staticUpstream,
      API_UPSTREAMS: apiUpstreams,
    })
    children.push({ name: 'edge', child: edge })
    await waitForLine(edge, /cluster-web-edge: ready/, 30_000)

    console.log(
      `cluster-web-supervise: ready ${publicUrl} `
      + `(shell=1 apis=${String(apiReplicas)} runners=${skipRunners ? '0' : String(runnerReplicas)} `
      + `overlays=${skipOverlays ? 'off' : 'on'})`,
    )

    await new Promise<void>(resolveWait => {
      for (const { child } of children) {
        child.on('exit', (code, signal) => {
          if (!stopping) {
            console.error(`cluster-web-supervise: child exited unexpectedly code=${String(code)} signal=${String(signal)}`)
            void stopAll().then(() => process.exit(code === 0 ? 0 : 1))
            resolveWait()
          }
        })
      }
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    await stopAll()
    process.exit(1)
  }
}

await main()

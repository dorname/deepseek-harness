/**
 * Core deployment smoke runner (`SMOKE-core-*`, change `user-fleet-gateway`).
 * Executes the staging smoke battery serially against the local deployment:
 * CLI health, web entry and static assets, credential guidance,
 * proxy trust fence, real-API key paths when a key exists, and the fleet
 * authentication/isolation/lifecycle cases against the running staging
 * deployment (state recorded by `scripts/fleet-staging/supervisor.ts`).
 * Every case appends one JSONL record to `OPENLOGOS_SMOKE_RESULT_PATH`.
 *
 * The whole-host CPU utilization is sampled during SMOKE-core-11 and must
 * stay under the deployment-configured threshold.
 *
 * @module
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStagingConfig, DSH_CLI_BIN, REPO_ROOT } from './fleet-staging/config.ts'
import { startCpuMonitor } from './fleet-staging/cpu-monitor.ts'
import { CookieJar, browserGet, loginThroughGateway } from './fleet-staging/gateway-login.ts'
import type { StagingState, StagedProcess } from './fleet-staging/fleet-stack.ts'

/** Result ledger path; `openlogos smoke` and this runner agree through the env override. */
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')

type CaseStatus = 'pass' | 'fail' | 'skip'

interface CaseOutcome {
  durationMs: number
  scenario: string
  status?: CaseStatus
  error?: string
}

/** Append one ledger record (the runner owns truncation at start). */
function report(id: string, outcome: CaseOutcome): void {
  const record: Record<string, unknown> = {
    id,
    status: outcome.status ?? 'pass',
    timestamp: new Date().toISOString(),
    duration_ms: outcome.durationMs,
    scenario: outcome.scenario,
  }
  if (outcome.error !== undefined) record.error = outcome.error
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`)
  console.log(`smoke-core: ${id} ${String(record.status)} (${String(record.duration_ms)}ms) ${outcome.scenario}`)
}

class CaseFailure extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CaseFailure(message)
}

/** Read `DEEPSEEK_API_KEY` from the environment or the repository `.env`; undefined when absent. */
function readApiKey(): string | undefined {
  if (process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY.length > 0) {
    return process.env.DEEPSEEK_API_KEY
  }
  const envFile = join(REPO_ROOT, '.env')
  if (!existsSync(envFile)) return undefined
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find(candidate => candidate.startsWith('DEEPSEEK_API_KEY='))
  if (line === undefined) return undefined
  const value = line.slice('DEEPSEEK_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
  return value.length > 0 ? value : undefined
}

/** Environment for deterministic no-credential web boots: fresh home, no key. */
function webBootEnvironment(home: string): NodeJS.ProcessEnv {
  const { DEEPSEEK_API_KEY: _key, ...rest } = process.env
  return { ...rest, DSH_HOME: home }
}

/** One finished CLI invocation. */
interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Run the built CLI once to completion. */
function runCli(args: readonly string[], options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): CliResult {
  const result = spawnSync('node', [DSH_CLI_BIN, ...args], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 60_000,
    env: options.env ?? process.env,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** One booted `dsh web` child with its readiness line parsed. */
interface WebBoot {
  port: number
  url: string
  child: ChildProcess
  output: string
  kill(): Promise<void>
}

/**
 * Boot one `dsh web` process and wait for its authenticated URL line.
 * @param options - fixed port (default OS-assigned), public URL/trusted host
 * extras, and whether the child keeps the parent credentials (default no).
 */
async function bootWeb(options: { port?: number; extraArgs?: string[]; keepCredentials?: boolean } = {}): Promise<WebBoot> {
  const home = join(tmpdir(), `dsh-smoke-home-${String(process.pid)}-${String(Date.now())}`)
  mkdirSync(home, { recursive: true })
  const args = [DSH_CLI_BIN, '--profile', 'web', '--no-open']
  if (options.port !== undefined) args.push('--port', String(options.port))
  args.push(...(options.extraArgs ?? []))
  const child = spawn('node', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.keepCredentials === true ? { ...process.env, DSH_HOME: home } : webBootEnvironment(home),
  })
  const boot = await new Promise<WebBoot>((resolveBoot, rejectBoot) => {
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      rejectBoot(new CaseFailure(`dsh web printed no URL within 60s; output so far:\n${output.slice(-2000)}`))
    }, 60_000)
    const handleChunk = (chunk: string | Buffer): void => {
      output += String(chunk)
      const match = /dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/?\S*)/.exec(output)
      if (match !== null && !settled) {
        settled = true
        clearTimeout(timer)
        const url = match[1] ?? ''
        resolveBoot({
          port: Number(match[2]),
          url,
          child,
          output,
          kill: async () => {
            child.kill('SIGTERM')
            const exited = new Promise<void>((resolveExit) => {
              child.once('exit', () => {
                resolveExit()
              })
            })
            const killTimer = setTimeout(() => {
              child.kill('SIGKILL')
            }, 5_000)
            await exited
            clearTimeout(killTimer)
            rmSync(home, { recursive: true, force: true })
          },
        })
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', handleChunk)
    child.stderr.on('data', handleChunk)
    child.once('exit', (code, signalName) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectBoot(new CaseFailure(`dsh web exited before readiness (code ${String(code)}, signal ${String(signalName)}):\n${output.slice(-2000)}`))
    })
  })
  return boot
}

/** GET one URL and resolve status/body; headers optional. */
async function getStatus(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { headers })
  const body = await response.text()
  return { status: response.status, body }
}

/** Issue a raw request whose `Host` header can differ from the target address. */
function requestWithHost(port: number, path: string, hostHeader: string): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const httpRequest = request(
      { host: '127.0.0.1', port, path, headers: { host: hostHeader } },
      (response) => {
        response.resume()
        response.on('end', () => {
          resolveStatus(response.statusCode ?? 0)
        })
      },
    )
    httpRequest.on('error', rejectStatus)
    httpRequest.end()
  })
}

/** Read the staging deployment state; null when no deployment is running. */
async function readStagingState(): Promise<{ state: StagingState; lifecyclePath: string } | undefined> {
  const config = loadStagingConfig()
  if (!existsSync(config.statePath)) return undefined
  const state = JSON.parse(readFileSync(config.statePath, 'utf8')) as StagingState
  const health = await fetch(new URL('/health', state.adminUrl)).then(response => response.status).catch(() => 0)
  if (health !== 200) return undefined
  return { state, lifecyclePath: config.lifecycleLogPath }
}

async function listStagedProcesses(adminUrl: string): Promise<StagedProcess[]> {
  const body = await fetch(new URL('/processes', adminUrl)).then(response => response.json()) as { processes: StagedProcess[] }
  return body.processes
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs: number, intervalMs = 500): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new CaseFailure(`timed out after ${String(timeoutMs)}ms waiting for ${what}`)
    }
    await new Promise(resolveTick => setTimeout(resolveTick, intervalMs))
  }
}

interface FleetContext {
  state: StagingState
  lifecyclePath: string
}

/** Require the staging deployment; smoke fleet cases fail loud without it. */
async function requireFleetDeployment(): Promise<FleetContext> {
  const deployment = await readStagingState()
  if (deployment === undefined) {
    throw new CaseFailure('staging fleet deployment is not running; start scripts/fleet-staging/supervisor.ts before smoke')
  }
  return deployment
}

/** Drive one OIDC login and return the authenticated browser identity. */
async function gatewayLogin(gatewayUrl: string, subject: string): Promise<{ cookie: string; response: Response }> {
  const { jar, response } = await loginThroughGateway(gatewayUrl, subject)
  return { cookie: jar.header() ?? '', response }
}

/** The serial smoke battery; order matters (earlier cases warm shared state). */
const cases: Array<{ id: string; scenario: string; run: () => CaseOutcome | void | Promise<CaseOutcome | void> }> = [
  {
    id: 'SMOKE-core-01',
    scenario: 'cli version health check',
    run: () => {
      const expected = (JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'cli', 'package.json'), 'utf8')) as { version: string }).version
      const result = runCli(['--version'])
      assert(result.status === 0, `--version exited ${String(result.status)}: ${result.stderr.slice(-500)}`)
      assert(result.stdout.includes(expected), `--version printed ${result.stdout.trim()}, expected ${expected}`)
    },
  },
  {
    id: 'SMOKE-core-02',
    scenario: 'web profile dump-config',
    run: () => {
      const result = runCli(['--profile', 'web', '--dump-config'])
      assert(result.status === 0, `--dump-config exited ${String(result.status)}: ${result.stderr.slice(-500)}`)
      assert(result.stdout.includes('web'), 'dump output does not mention the web composition')
    },
  },
  {
    id: 'SMOKE-core-03',
    scenario: 'web core entry and static assets',
    run: async () => {
      const boot = await bootWeb()
      try {
        const jar = new CookieJar()
        const page = await browserGet(jar, boot.url)
        assert(page.status === 200, `authenticated index returned ${String(page.status)}`)
        const body = await page.text()
        const asset = /assets\/[^"']+\.js/.exec(body)?.[0]
        assert(asset !== undefined, 'served index does not reference an /assets bundle')
        const bundle = await getStatus(new URL(asset, boot.url).href, { cookie: jar.header() ?? '' })
        assert(bundle.status === 200, `bundle ${asset} returned ${String(bundle.status)}`)
      } finally {
        await boot.kill()
      }
    },
  },
  {
    id: 'SMOKE-core-04',
    scenario: 'no-credential boot guides instead of crashing',
    run: async () => {
      const boot = await bootWeb()
      try {
        const jar = new CookieJar()
        const page = await browserGet(jar, boot.url)
        assert(page.status === 200, `authenticated index returned ${String(page.status)}`)
        await new Promise(resolveSettle => setTimeout(resolveSettle, 2_000))
        assert(boot.child.exitCode === null && boot.child.signalCode === null, 'web process crashed without credentials')
        assert(!/uncaught|ERR_UNCAUGHT|fatal exception/i.test(boot.output), `boot log carries a fatal error:\n${boot.output.slice(-1000)}`)
      } finally {
        await boot.kill()
      }
    },
  },
  {
    id: 'SMOKE-core-05',
    scenario: 'proxy trust fence accepts trusted Host and rejects foreign Host',
    run: async () => {
      const port = await new Promise<number>((resolvePort, rejectPort) => {
        const probe: Server = createServer((_requestHead, response) => {
          response.destroy()
        })
        probe.listen(0, '127.0.0.1', () => {
          const address = probe.address()
          if (address === null || typeof address === 'string') {
            rejectPort(new CaseFailure('port probe failed'))
            return
          }
          const boundPort = address.port
          probe.close(() => {
            resolvePort(boundPort)
          })
        })
      })
      const boot = await bootWeb({
        port,
        extraArgs: ['--public-url', `http://127.0.0.1:${String(port)}`, '--trusted-host', `127.0.0.1:${String(port)}`],
      })
      try {
        const trusted = await requestWithHost(port, '/api', `127.0.0.1:${String(port)}`)
        assert(trusted !== 403, `trusted Host was rejected with ${String(trusted)}`)
        const foreign = await requestWithHost(port, '/api', 'attacker.example')
        assert(foreign === 403, `foreign Host expected 403, got ${String(foreign)}`)
      } finally {
        await boot.kill()
      }
    },
  },
  {
    id: 'SMOKE-core-06',
    scenario: 'headless minimal task chain (real API)',
    run: () => {
      const key = readApiKey()
      if (key === undefined) {
        return { scenario: 'headless minimal task (real API)', status: 'skip' }
      }
      const home = join(tmpdir(), `dsh-smoke-headless-${String(Date.now())}`)
      mkdirSync(home, { recursive: true })
      const result = runCli(['--profile', 'headless', 'Reply with exactly: ok'], {
        env: { ...process.env, DEEPSEEK_API_KEY: key, DSH_HOME: home },
        timeoutMs: 180_000,
      })
      rmSync(home, { recursive: true, force: true })
      assert(result.status === 0, `headless run exited ${String(result.status)}: ${(result.stderr || result.stdout).slice(-800)}`)
      assert(result.stdout.trim().length > 0, 'headless run printed no answer')
    },
  },
  {
    id: 'SMOKE-core-07',
    scenario: 'TS SDK initialize handshake and minimal run (real API)',
    run: async () => {
      const key = readApiKey()
      if (key === undefined) {
        return { scenario: 'TS SDK minimal run (real API)', status: 'skip' }
      }
      const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
      const home = join(tmpdir(), `dsh-smoke-sdk-${String(Date.now())}`)
      mkdirSync(home, { recursive: true })
      const harness = new DeepSeekHarness({
        profile: 'sdk',
        dshBin: DSH_CLI_BIN,
        dshHome: home,
        initializeTimeoutMs: 30_000,
        requestTimeoutMs: 120_000,
        env: { ...process.env, DEEPSEEK_API_KEY: key },
      })
      try {
        await harness.start()
        const result = await harness.run('Reply with exactly: ok')
        assert(result.finalResponse.trim().length > 0, 'SDK run returned an empty final response')
      } finally {
        await harness.close()
        rmSync(home, { recursive: true, force: true })
      }
    },
  },
  {
    id: 'SMOKE-core-09',
    scenario: 'fleet gateway authentication and per-user routing',
    run: async () => {
      const { state, lifecyclePath } = await requireFleetDeployment()
      const { cookie, response } = await gatewayLogin(state.gatewayUrl, 'smoke-alice')
      assert(response.status === 200, `login flow ended with ${String(response.status)}`)
      await waitFor('provisioned smoke-alice', () =>
        readFileSync(lifecyclePath, 'utf8').includes('"kind":"provisioned","subject":"smoke-alice"'), 60_000)
      const processes = await listStagedProcesses(state.adminUrl)
      assert(processes.some(entry => entry.subject === 'smoke-alice'), 'smoke-alice has no provisioned process')
      assert(existsSync(join(state.homesDir, 'smoke-alice')), 'smoke-alice home was not created')
      void cookie
    },
  },
  {
    id: 'SMOKE-core-10',
    scenario: 'cross-user isolation spot check',
    run: async () => {
      const { state } = await requireFleetDeployment()
      const bob = await gatewayLogin(state.gatewayUrl, 'smoke-bob')
      assert(bob.response.status === 200, `bob login flow ended with ${String(bob.response.status)}`)
      const intrusion = await fetch(new URL('/sessions/smoke-alice/private-transcript', state.gatewayUrl), {
        headers: { cookie: bob.cookie },
      })
      // The gateway routes strictly by the cookie's subject, so an A-owned
      // session URL lands in bob's own process, which answers 403/404 without
      // ever reaching alice's process or data.
      assert(intrusion.status === 403 || intrusion.status === 404,
        `cross-user access expected an explicit rejection, got ${String(intrusion.status)}`)
      const ownPage = await fetch(new URL('/', state.gatewayUrl), { headers: { cookie: bob.cookie } })
      assert(ownPage.status === 200, `bob own UI expected 200, got ${String(ownPage.status)}`)
      const processes = await listStagedProcesses(state.adminUrl)
      const alice = processes.find(entry => entry.subject === 'smoke-alice')
      const bobProcess = processes.find(entry => entry.subject === 'smoke-bob')
      assert(alice !== undefined && bobProcess !== undefined, 'both users must hold distinct processes')
      assert(alice.port !== bobProcess.port && alice.home !== bobProcess.home, 'alice and bob share a port or home')
    },
  },
  {
    id: 'SMOKE-core-11',
    scenario: 'fleet lifecycle and resource limits',
    run: async () => {
      const { state, lifecyclePath } = await requireFleetDeployment()
      const config = loadStagingConfig()
      const monitor = startCpuMonitor()
      try {
        // Only events this run triggers count: snapshot the log size up front
        // so accumulated history from earlier runs cannot satisfy the waits.
        const baselineOffset = readFileSync(lifecyclePath, 'utf8').length
        const lifecycle = (): string => readFileSync(lifecyclePath, 'utf8').slice(baselineOffset)

        // Idle recycle keeps the home; relogin provisions into the same home.
        await waitFor('recycled smoke-alice', () => lifecycle().includes('"kind":"recycled","subject":"smoke-alice"'),
          config.idleRecycleMs * 2 + 20_000)
        assert(existsSync(join(state.homesDir, 'smoke-alice')), 'idle recycle deleted the user home')
        const aliceHomeBefore = (await listStagedProcesses(state.adminUrl)).find(entry => entry.subject === 'smoke-alice')
        if (aliceHomeBefore === undefined) {
          const aliceAgain = await gatewayLogin(state.gatewayUrl, 'smoke-alice')
          assert(aliceAgain.response.status === 200, `alice relogin after recycle ended ${String(aliceAgain.response.status)}`)
        }

        // Crash restart is bounded and isolated; both subjects must be alive
        // first (earlier cases may have let them idle out).
        const ensureAlive = async (subject: string): Promise<void> => {
          const live = (await listStagedProcesses(state.adminUrl)).some(entry => entry.subject === subject)
          if (!live) {
            const relogin = await gatewayLogin(state.gatewayUrl, subject)
            assert(relogin.response.status === 200, `${subject} relogin ended ${String(relogin.response.status)}`)
          }
        }
        await ensureAlive('smoke-alice')
        await ensureAlive('smoke-bob')
        const bobProcess = (await listStagedProcesses(state.adminUrl)).find(entry => entry.subject === 'smoke-bob')
        assert(bobProcess?.pid !== undefined, 'smoke-bob must be alive for the crash case')
        const killed = await fetch(new URL('/kill/smoke-bob', state.adminUrl), { method: 'POST' })
        assert(killed.status === 200, `crash injection failed: ${String(killed.status)}`)
        await waitFor('restarted smoke-bob', () => lifecycle().includes('"kind":"restarted","subject":"smoke-bob"'), 60_000)

        // Capacity: with alice and bob alive the next login is rejected.
        const carol = await gatewayLogin(state.gatewayUrl, 'smoke-carol')
        assert(carol.response.status === 503, `full-capacity login expected 503, got ${String(carol.response.status)}`)

        const peak = monitor.peakPercent()
        assert(peak <= config.cpuThresholdPercent,
          `CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
        return {
          scenario: `fleet lifecycle; CPU peak ${peak.toFixed(1)}% <= ${String(config.cpuThresholdPercent)}%`,
        }
      } finally {
        monitor.stop()
      }
    },
  },
]

/** Run the battery serially, writing one ledger record per case. */
async function main(): Promise<void> {
  mkdirSync(join(RESULT_PATH, '..'), { recursive: true })
  let failures = 0
  let skips = 0
  for (const entry of cases) {
    const started = Date.now()
    try {
      const outcome = await entry.run()
      if (outcome?.status === 'skip') {
        skips += 1
        report(entry.id, { durationMs: Date.now() - started, scenario: outcome.scenario, status: 'skip' })
      } else {
        report(entry.id, { durationMs: Date.now() - started, scenario: outcome?.scenario ?? entry.scenario })
      }
    } catch (error) {
      failures += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`smoke-core: ${entry.id} FAILED: ${message}`)
      report(entry.id, { durationMs: Date.now() - started, scenario: entry.scenario, status: 'fail', error: message })
    }
  }
  console.log(`smoke-core: ${String(cases.length)} cases, ${String(failures)} failed, ${String(skips)} skipped`)
  if (failures > 0) process.exitCode = 1
}

await main()

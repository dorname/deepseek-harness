/**
 * ST-S33-03 — acceptance execution under the CPU constraint (change
 * `user-fleet-gateway`): boot a small-cap staging deployment, enact the S31–S33
 * scenario battery serially against it, then fill the deployment to its cap
 * and require the next login to be explicitly rejected. The whole run sits
 * under the host CPU monitor; a peak above the deployment-configured
 * threshold fails the case. S32-02 (approval-card fan-out) stays with its
 * gateway suite coverage: the staging stack cannot synthesize a real approval
 * without model credentials.
 *
 * Result: one `ST-S33-03` record appended to `OPENLOGOS_RESULT_FILE`.
 *
 * @module
 */

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { startCpuMonitor, type CpuMonitor } from './cpu-monitor.ts'
import { startFleetStack, type FleetStack, type StagedProcess } from './fleet-stack.ts'
import { loginThroughGateway } from './gateway-login.ts'

interface LifecycleRecord {
  kind: string
  subject: string
  detail?: string
}

class AssertionError extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message)
}

/** Poll until `predicate` holds; throw with `what` once `timeoutMs` elapses. */
async function waitFor(what: string, predicate: () => boolean, timeoutMs: number, intervalMs = 250): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new AssertionError(`timed out after ${String(timeoutMs)}ms waiting for ${what}`)
    }
    await new Promise(resolveTick => setTimeout(resolveTick, intervalMs))
  }
}

function readLifecycle(path: string): LifecycleRecord[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as LifecycleRecord)
}

async function listProcesses(stack: FleetStack): Promise<StagedProcess[]> {
  const response = await fetch(new URL('/processes', stack.adminUrl))
  const body = await response.json() as { processes: StagedProcess[] }
  return body.processes
}

/** Append the OpenLogos ledger record; the dispatcher owns truncation. */
function report(id: string, status: 'pass' | 'fail', startedAt: number, error?: string): void {
  const file = process.env.OPENLOGOS_RESULT_FILE
  if (file === undefined) {
    console.log(`${id}: ${status} (OPENLOGOS_RESULT_FILE unset; not recording)`)
    return
  }
  const record: Record<string, unknown> = { id, status, timestamp: new Date().toISOString(), duration_ms: Date.now() - startedAt }
  if (error !== undefined) record.error = error
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(record)}\n`)
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const privateRoot = mkdtempSync(join(tmpdir(), 'fleet-acceptance-'))
  let monitor: CpuMonitor | undefined
  let stack: FleetStack | undefined
  try {
    const cpu = startCpuMonitor()
    monitor = cpu
    stack = await startFleetStack({ stagingRoot: privateRoot })
    const { config, gatewayUrl } = stack
    const recycleBudget = config.idleRecycleMs * 2 + 15_000

    // ST-S31-01: first login provisions the subject's own UI under its home.
    const alice = await loginThroughGateway(gatewayUrl, 'acc-alice')
    assert(alice.response.status === 200, `alice login expected 200, got ${String(alice.response.status)}`)
    await waitFor('provisioned acc-alice', () =>
      readLifecycle(config.lifecycleLogPath).some(event => event.kind === 'provisioned' && event.subject === 'acc-alice'), 30_000)
    assert(existsSync(join(config.homesDir, 'acc-alice')), 'alice home was not created under the homes root')

    // ST-S31-02: rejected authorization opens no session and provisions nothing.
    const denied = await loginThroughGateway(gatewayUrl, 'deny-bob')
    assert(denied.response.status === 401, `denied login expected 401, got ${String(denied.response.status)}`)
    assert(!(await listProcesses(stack)).some(entry => entry.subject === 'deny-bob'), 'denied subject got a process')

    // ST-S32-01: a cross-user URL is explicitly rejected, not forwarded.
    const carol = await loginThroughGateway(gatewayUrl, 'acc-carol')
    assert(carol.response.status === 200, `carol login expected 200, got ${String(carol.response.status)}`)
    const intrusion = await fetch(new URL('/sessions/acc-alice/private-transcript', gatewayUrl), {
      headers: { cookie: carol.jar.header() ?? '' },
    })
    // The gateway routes strictly by the cookie's subject, so an A-owned
    // session URL lands in carol's own process and is rejected there.
    assert(intrusion.status === 403 || intrusion.status === 404,
      `cross-user access expected an explicit rejection, got ${String(intrusion.status)}`)

    // ST-S33-01: idle recycling keeps the home; relogin reuses it.
    await waitFor('recycled acc-alice', () =>
      readLifecycle(config.lifecycleLogPath).some(event => event.kind === 'recycled' && event.subject === 'acc-alice'), recycleBudget)
    assert(existsSync(join(config.homesDir, 'acc-alice')), 'recycle deleted the user home')
    const aliceAgain = await loginThroughGateway(gatewayUrl, 'acc-alice')
    assert(aliceAgain.response.status === 200, `alice relogin expected 200, got ${String(aliceAgain.response.status)}`)
    const afterRecycle = await listProcesses(stack)
    const aliceHome = afterRecycle.find(entry => entry.subject === 'acc-alice')?.home
    assert(aliceHome === join(config.homesDir, 'acc-alice'), `alice relogin landed in ${String(aliceHome)}`)

    // ST-S33-02: a crash restarts only the crashed subject. Carol may have
    // idled out during the recycle wait, so ensure she is live first.
    if (!(await listProcesses(stack)).some(entry => entry.subject === 'acc-carol')) {
      const carolAgain = await loginThroughGateway(gatewayUrl, 'acc-carol')
      assert(carolAgain.response.status === 200, `carol relogin expected 200, got ${String(carolAgain.response.status)}`)
    }
    const carolPidBefore = (await listProcesses(stack)).find(entry => entry.subject === 'acc-carol')?.pid
    assert(carolPidBefore !== undefined, 'carol must be alive for the crash step')
    const killResponse = await fetch(new URL('/kill/acc-carol', stack.adminUrl), { method: 'POST' })
    assert(killResponse.status === 200, `crash injection failed: ${String(killResponse.status)}`)
    await waitFor('restarted acc-carol', () =>
      readLifecycle(config.lifecycleLogPath).some(event => event.kind === 'restarted' && event.subject === 'acc-carol'), 60_000)
    const carolPidAfter = (await listProcesses(stack)).find(entry => entry.subject === 'acc-carol')?.pid
    assert(carolPidAfter !== undefined && carolPidAfter !== carolPidBefore, 'carol was not restarted into a new process')
    const alicePid = (await listProcesses(stack)).find(entry => entry.subject === 'acc-alice')?.pid
    assert(alicePid !== undefined, 'alice lost her process while carol crashed')

    // Full at cap: the next login is explicitly rejected, never oversubscribed.
    const dave = await loginThroughGateway(gatewayUrl, 'acc-dave')
    assert(dave.response.status === 503, `full-capacity login expected 503, got ${String(dave.response.status)}`)

    // The whole serial run stayed under the deployment CPU threshold.
    await waitFor('cpu sampler to tick', () => cpu.peakPercent() > 0, 3_000)
    const peak = cpu.peakPercent()
    assert(peak <= config.cpuThresholdPercent, `CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
    console.log(`fleet-staging: CPU peak ${peak.toFixed(1)}% <= threshold ${String(config.cpuThresholdPercent)}%`)
    report('ST-S33-03', 'pass', startedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`fleet-staging: ST-S33-03 FAILED: ${message}`)
    if (monitor !== undefined) {
      console.error(`fleet-staging: CPU peak at failure ${monitor.peakPercent().toFixed(1)}%`)
    }
    report('ST-S33-03', 'fail', startedAt, message)
    process.exitCode = 1
  } finally {
    monitor?.stop()
    await stack?.dispose()
    rmSync(privateRoot, { recursive: true, force: true })
  }
}

await main()

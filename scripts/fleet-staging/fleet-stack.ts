/**
 * The local staging fleet stack: OIDC test provider + fleet manager + gateway
 * plus a loopback admin surface for observability and fault injection. One
 * supervisor process owns the whole topology; `supervisor.ts` runs it as the
 * deployment, while the acceptance runner boots a private instance of the
 * same builder. Lifecycle events stream to stdout and the deployment's
 * JSONL lifecycle log, which smoke cases read back as behavior evidence.
 *
 * @module
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { FleetManager } from '@deepseek-ai/dsh-fleet-manager'
import { FleetGateway } from '@deepseek-ai/dsh-gateway'
import { loadStagingConfig, type StagingConfig } from './config.ts'
import { startOidcTestProvider, type OidcTestProvider } from './oidc-test-provider.ts'

/** One subject's live process as the admin surface reports it. */
export interface StagedProcess {
  subject: string
  port: number
  pid: number | undefined
  home: string
}

/** Deployment state persisted beside the running stack. */
export interface StagingState {
  /** Supervisor process id (SIGTERM it for a graceful rollback). */
  supervisorPid: number
  /** Gateway root URL browsers use, e.g. `http://127.0.0.1:PORT`. */
  gatewayUrl: string
  /** Test provider issuer root. */
  issuer: string
  /** Loopback admin root for health, process listing, and crash injection. */
  adminUrl: string
  /** Per-user homes root. */
  homesDir: string
  /** ISO start time of the deployment. */
  startedAt: string
}

/** One running staging stack. */
export interface FleetStack {
  /** Resolved configuration the stack runs with. */
  config: StagingConfig
  /** Test provider behind the gateway. */
  provider: OidcTestProvider
  /** Gateway root URL. */
  gatewayUrl: string
  /** Admin surface URL. */
  adminUrl: string
  /** Record deployment state into `state.json` (supervisor startup). */
  writeState(): void
  /** Stop gateway, manager (and its user processes), admin surface, and provider. */
  dispose(): Promise<void>
}

/** Loopback admin surface: health, live process listing, and crash injection. */
function startAdminServer(manager: FleetManager): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://admin.invalid')
    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    if (url.pathname === '/processes') {
      const processes = manager.listActive().map((subject): StagedProcess | undefined => {
        const info = manager.processInfo(subject)
        return info === undefined ? undefined : { subject, port: info.port, pid: info.pid, home: info.home }
      }).filter((entry): entry is StagedProcess => entry !== undefined)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ processes }))
      return
    }
    const kill = /^\/kill\/([^/]+)$/.exec(url.pathname)
    if (kill?.[1] !== undefined && request.method === 'POST') {
      const info = manager.processInfo(decodeURIComponent(kill[1]))
      if (info?.pid === undefined) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'no running process for subject' }))
        return
      }
      // SIGKILL the user process the way a real crash dies: no cleanup, the
      // manager observes the exit and owns the restart decision.
      process.kill(info.pid, 'SIGKILL')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ killed: info.pid }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        rejectListen(new Error('fleet-staging: admin surface failed to bind a loopback port'))
        return
      }
      resolveListen({
        url: `http://127.0.0.1:${String(address.port)}`,
        close: () => new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error !== undefined) rejectClose(error)
            else resolveClose()
          })
        }),
      })
    })
  })
}

/**
 * Boot one staging fleet stack.
 * @param overrides - `stagingRoot` moves every deployment path under a
 * private root (the acceptance runner isolates its instance this way);
 * `lifecycleSink` replaces the default lifecycle destinations (deployment
 * lifecycle log plus stdout).
 * @returns the running stack.
 */
export async function startFleetStack(
  overrides: { stagingRoot?: string; lifecycleSink?: (event: unknown) => void } = {},
): Promise<FleetStack> {
  const base = loadStagingConfig()
  let config: StagingConfig = base
  if (overrides.stagingRoot !== undefined) {
    const root = overrides.stagingRoot
    config = {
      ...base,
      stagingRoot: root,
      homesDir: join(root, 'homes'),
      statePath: join(root, 'state.json'),
      lifecycleLogPath: join(root, 'lifecycle.jsonl'),
    }
  }
  mkdirSync(config.homesDir, { recursive: true })
  const provider = await startOidcTestProvider(config.oidc)
  const lifecycleSink = overrides.lifecycleSink ?? ((event: unknown): void => {
    appendFileSync(config.lifecycleLogPath, `${JSON.stringify(event)}\n`)
    console.log(JSON.stringify(event))
  })
  const manager = new FleetManager(
    {
      homesDir: config.homesDir,
      dshCommand: config.dshCommand,
      maxUsers: config.maxUsers,
      idleRecycleMs: config.idleRecycleMs,
      maxRestarts: config.maxRestarts,
      restartWindowMs: config.restartWindowMs,
      stopTimeoutMs: config.stopTimeoutMs,
      portReadyTimeoutMs: config.portReadyTimeoutMs,
    },
    { logger: lifecycleSink },
  )
  manager.startRecycleLoop()
  const gateway = new FleetGateway(
    {
      homesDir: config.homesDir,
      host: '127.0.0.1',
      port: 0,
      oidc: { ...config.oidc, issuer: provider.issuer },
    },
    { fleetManager: manager },
  )
  const { port } = await gateway.start()
  const admin = await startAdminServer(manager)
  const gatewayUrl = `http://127.0.0.1:${String(port)}`
  return {
    config,
    provider,
    gatewayUrl,
    adminUrl: admin.url,
    writeState(): void {
      const state: StagingState = {
        supervisorPid: process.pid,
        gatewayUrl,
        issuer: provider.issuer,
        adminUrl: admin.url,
        homesDir: config.homesDir,
        startedAt: new Date().toISOString(),
      }
      mkdirSync(config.stagingRoot, { recursive: true })
      writeFileSync(config.statePath, `${JSON.stringify(state, null, 2)}\n`)
    },
    async dispose(): Promise<void> {
      await gateway.dispose()
      await manager.dispose()
      await admin.close()
      await provider.close()
    },
  }
}

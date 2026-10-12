/**
 * API container entry (S47): one loopback API-only dsh + in-network forwarder.
 * Compose scales this service for container-level replicas.
 *
 * @module
 */

import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  API_OVERLAY_TEMPLATE,
  dshBin,
  ensureDir,
  FORWARD_SCRIPT,
  renderOverlay,
  spawnLogged,
  waitForLine,
} from './process-helpers.mts'

interface ChildSpec {
  name: string
  child: ChildProcess
}

async function main(): Promise<void> {
  const forwardPort = Number(process.env.FORWARD_PORT ?? process.env.API_FORWARD_PORT ?? '3080')
  const loopbackPort = Number(process.env.API_LOOPBACK_PORT ?? '13080')
  const edgePort = Number(process.env.EDGE_PORT ?? '8080')
  const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${String(edgePort)}/`
  const trustedHost = process.env.TRUSTED_HOST ?? `127.0.0.1:${String(edgePort)}`
  const databaseUrl = process.env.DATABASE_URL ?? ''
  const skipOverlays = process.env.CLUSTER_WEB_SKIP_OVERLAYS === '1' || databaseUrl === ''

  if (!Number.isInteger(forwardPort) || forwardPort <= 0) throw new Error('api: FORWARD_PORT invalid')
  if (!Number.isInteger(loopbackPort) || loopbackPort <= 0) throw new Error('api: API_LOOPBACK_PORT invalid')

  const workDir = mkdtempSync(join(tmpdir(), 'dsh-cluster-web-api-'))
  ensureDir(workDir)
  const dshHome = process.env.DSH_HOME ?? join(workDir, 'home')
  ensureDir(dshHome)

  const children: ChildSpec[] = []
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
    const args = ['--import', 'tsx/esm', dshBin(), '--profile', 'web']
    if (!skipOverlays && existsSync(API_OVERLAY_TEMPLATE)) {
      const overlayPath = join(workDir, 'api.overlay.yml')
      renderOverlay(API_OVERLAY_TEMPLATE, { __DATABASE_URL__: databaseUrl }, overlayPath)
      args.push('--patch', overlayPath)
    }
    args.push(
      '--api-only',
      '--no-open',
      '--host', '127.0.0.1',
      '--port', String(loopbackPort),
      '--public-url', publicUrl,
      '--trusted-host', trustedHost,
    )
    const api = spawnLogged('api', process.execPath, args, childEnv())
    children.push({ name: 'api', child: api })
    await waitForLine(api, /dsh web: http/, 120_000)

    const forward = spawnLogged('forward', process.execPath, ['--import', 'tsx/esm', FORWARD_SCRIPT], {
      ...process.env,
      FORWARD_PORT: String(forwardPort),
      LOOPBACK_UPSTREAM: `127.0.0.1:${String(loopbackPort)}`,
    })
    children.push({ name: 'forward', child: forward })
    await waitForLine(forward, /cluster-web-forward: ready/, 30_000)

    console.log(
      `cluster-web-api: ready forward=0.0.0.0:${String(forwardPort)} `
      + `dsh=127.0.0.1:${String(loopbackPort)}`,
    )

    await new Promise<void>(resolveWait => {
      for (const { child } of children) {
        child.on('exit', (code, signal) => {
          if (!stopping) {
            console.error(`cluster-web-api: child exited unexpectedly code=${String(code)} signal=${String(signal)}`)
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

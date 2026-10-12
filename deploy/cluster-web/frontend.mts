/**
 * Frontend container entry (S47): loopback shell + public edge.
 * `API_UPSTREAMS` points at the compose `api` service forwarder (Docker DNS RR).
 *
 * @module
 */

import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import {
  dshBin,
  EDGE_SCRIPT,
  ensureDir,
  renderOverlay,
  SHELL_OVERLAY_TEMPLATE,
  spawnLogged,
  waitForLine,
} from './process-helpers.mts'

interface ChildSpec {
  name: string
  child: ChildProcess
}

async function main(): Promise<void> {
  const edgePort = Number(process.env.EDGE_PORT ?? '8080')
  const shellPort = Number(process.env.SHELL_PORT ?? '3079')
  const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${String(edgePort)}/`
  const trustedHost = process.env.TRUSTED_HOST ?? `127.0.0.1:${String(edgePort)}`
  const apiUpstreams = (process.env.API_UPSTREAMS ?? 'api:3080').trim()
  const databaseUrl = process.env.DATABASE_URL ?? ''
  const skipOverlays = process.env.CLUSTER_WEB_SKIP_OVERLAYS === '1' || databaseUrl === ''

  if (!Number.isInteger(edgePort) || edgePort <= 0) throw new Error('frontend: EDGE_PORT invalid')
  if (!Number.isInteger(shellPort) || shellPort <= 0) throw new Error('frontend: SHELL_PORT invalid')
  if (apiUpstreams.length === 0) throw new Error('frontend: API_UPSTREAMS required')

  const workDir = mkdtempSync(join(tmpdir(), 'dsh-cluster-web-fe-'))
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
    const shell = spawnLogged('shell', process.execPath, args, childEnv())
    children.push({ name: 'shell', child: shell })
    await waitForLine(shell, /dsh web: http/, 120_000)

    const edge = spawnLogged('edge', process.execPath, ['--import', 'tsx/esm', EDGE_SCRIPT], {
      ...process.env,
      EDGE_PORT: String(edgePort),
      STATIC_UPSTREAM: `127.0.0.1:${String(shellPort)}`,
      API_UPSTREAMS: apiUpstreams,
    })
    children.push({ name: 'edge', child: edge })
    await waitForLine(edge, /cluster-web-edge: ready/, 30_000)

    console.log(`cluster-web-frontend: ready ${publicUrl} (shell+edge; api=${apiUpstreams})`)

    await new Promise<void>(resolveWait => {
      for (const { child } of children) {
        child.on('exit', (code, signal) => {
          if (!stopping) {
            console.error(`cluster-web-frontend: child exited unexpectedly code=${String(code)} signal=${String(signal)}`)
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

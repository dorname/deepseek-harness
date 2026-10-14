/**
 * `dsh up` — launch the cluster-web same-origin process tree (P1).
 * Forwards to `deploy/cluster-web/supervise.mts` with replica caps that match
 * the acceptance CPU contract (hard max 2).
 *
 * @module @deepseek-ai/dsh/up
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command, CommanderError } from 'commander'

const MAX_REPLICAS = 2

/** Resolved flags for {@link runUp}. */
export interface UpOptions {
  /** Edge listen port. */
  edgePort: number
  /** Loopback API base port. */
  apiBasePort?: number
  /** API replica count (1..2). */
  apiReplicas: number
  /** Runner replica count (0..2). */
  runnerReplicas: number
  /** Advertised public URL. */
  publicUrl?: string
  /** Trusted Host authority. */
  trustedHost?: string
  /** Skip Postgres overlays. */
  skipOverlays: boolean
  /** Skip runner processes. */
  skipRunners: boolean
}

function repoRootFromHere(): string {
  // apps/cli/src → repo root; apps/cli/lib → same depth.
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}

function supervisePath(): string {
  const root = repoRootFromHere()
  const candidate = join(root, 'deploy', 'cluster-web', 'supervise.mts')
  if (!existsSync(candidate)) {
    throw new Error(`dsh up: missing ${candidate}; run from a deepseek-harness checkout that includes deploy/cluster-web`)
  }
  return candidate
}

/**
 * Parse `dsh up` argv into {@link UpOptions}.
 * @param argv - tokens after `up`.
 * @returns validated options.
 */
export function parseUpArgs(argv: readonly string[]): UpOptions {
  const program = new Command()
    .name('dsh up')
    .description('Start the same-origin cluster-web process tree (edge + loopback API).')
    .helpOption('-h, --help', 'show this help')
    .option('--edge-port <port>', 'edge listen port', '8080')
    .option('--api-base-port <port>', 'first loopback API port')
    .option('--api-replicas <n>', 'API replicas (1..2; smoke default 1)', '1')
    .option('--runner-replicas <n>', 'runner replicas (0..2; smoke default 0)', '0')
    .option('--public-url <url>', 'advertised HTTP(S) root')
    .option('--trusted-host <authority>', 'browser-facing authority for the /api fence')
    .option('--skip-overlays', 'boot without Postgres overlays', false)
    .option('--skip-runners', 'do not start runners', false)
    .allowExcessArguments(false)
    .exitOverride()

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) throw new Error(error.message)
    throw error
  }
  const opts = program.opts<{
    edgePort: string
    apiBasePort?: string
    apiReplicas: string
    runnerReplicas: string
    publicUrl?: string
    trustedHost?: string
    skipOverlays: boolean
    skipRunners: boolean
  }>()

  const edgePort = Number(opts.edgePort)
  const apiReplicas = Number(opts.apiReplicas)
  const runnerReplicas = Number(opts.runnerReplicas)
  if (!Number.isInteger(edgePort) || edgePort <= 0) program.error('error: --edge-port must be a positive integer')
  if (!Number.isInteger(apiReplicas) || apiReplicas < 1 || apiReplicas > MAX_REPLICAS) {
    program.error(`error: --api-replicas must be an integer in 1..${String(MAX_REPLICAS)}`)
  }
  if (!Number.isInteger(runnerReplicas) || runnerReplicas < 0 || runnerReplicas > MAX_REPLICAS) {
    program.error(`error: --runner-replicas must be an integer in 0..${String(MAX_REPLICAS)}`)
  }
  const result: UpOptions = {
    edgePort,
    apiReplicas,
    runnerReplicas,
    skipOverlays: opts.skipOverlays,
    skipRunners: opts.skipRunners || runnerReplicas === 0,
  }
  if (opts.apiBasePort !== undefined) {
    const apiBasePort = Number(opts.apiBasePort)
    if (!Number.isInteger(apiBasePort) || apiBasePort <= 0) {
      program.error('error: --api-base-port must be a positive integer')
    }
    result.apiBasePort = apiBasePort
  }
  if (opts.publicUrl !== undefined) result.publicUrl = opts.publicUrl
  if (opts.trustedHost !== undefined) result.trustedHost = opts.trustedHost
  return result
}

/**
 * Run the cluster-web supervisor until it exits.
 * SIGINT and SIGTERM reach the supervisor; the launcher waits for its exit and closed stdio.
 * @param options - validated up flags.
 * @returns the supervise process exit code.
 */
export async function runUp(options: UpOptions): Promise<number> {
  const script = supervisePath()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EDGE_PORT: String(options.edgePort),
    API_REPLICAS: String(options.apiReplicas),
    RUNNER_REPLICAS: String(options.runnerReplicas),
  }
  if (options.apiBasePort !== undefined) env.API_BASE_PORT = String(options.apiBasePort)
  if (options.publicUrl !== undefined) env.PUBLIC_URL = options.publicUrl
  if (options.trustedHost !== undefined) env.TRUSTED_HOST = options.trustedHost
  if (options.skipOverlays) env.CLUSTER_WEB_SKIP_OVERLAYS = '1'
  if (options.skipRunners) env.CLUSTER_WEB_SKIP_RUNNERS = '1'
  if (env.DSH_CONFIG_READONLY === undefined) env.DSH_CONFIG_READONLY = '1'

  return await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', script], {
      env,
      stdio: 'inherit',
      cwd: repoRootFromHere(),
    })
    const forwardInterrupt = (): void => { child.kill('SIGINT') }
    const forwardTermination = (): void => { child.kill('SIGTERM') }
    process.on('SIGINT', forwardInterrupt)
    process.on('SIGTERM', forwardTermination)
    const cleanup = (): void => {
      process.off('SIGINT', forwardInterrupt)
      process.off('SIGTERM', forwardTermination)
    }
    child.once('error', (error) => { cleanup(); reject(error) })
    child.once('close', (code, signal) => {
      cleanup()
      if (signal) resolveExit(1)
      else resolveExit(code ?? 1)
    })
  })
}

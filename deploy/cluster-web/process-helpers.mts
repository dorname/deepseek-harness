/**
 * Shared spawn/wait helpers for cluster-web frontend/api/supervise trees.
 *
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..')
export const DSH_BIN_BUILT = join(REPO_ROOT, 'apps/cli/lib/bin.js')
export const DSH_BIN_SOURCE = join(REPO_ROOT, 'apps/cli/src/bin.ts')
export const EDGE_SCRIPT = join(HERE, 'edge.mts')
export const FORWARD_SCRIPT = join(HERE, 'forward.mts')
export const NO_POSTGRES_PATCH = join(HERE, 'overlays', 'no-postgres.patch.yml')

/** Prefer built CLI; fall back to source-launch entry used by `pnpm dsh`. */
export function dshBin(): string {
  return existsSync(DSH_BIN_BUILT) ? DSH_BIN_BUILT : DSH_BIN_SOURCE
}

export const MAX_API_REPLICAS = 2

export function requirePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`cluster-web: ${name} must be a non-negative integer, got ${String(raw)}`)
  }
  return value
}

/**
 * Launcher-position arguments for the invocation-time no-Postgres override.
 * The launcher's flags (`--profile`, `--patch`) must precede the app's own
 * flags: `dsh` hands everything from the first app flag onward to the profile
 * command, so splice these directly after `--profile`. The profile bundles own
 * the Postgres composition; this patch is the documented call-site override
 * that disables those rows and restores local JSONL persistence, so topology
 * checks run without Postgres.
 * @param databaseUrl - the resolved `DATABASE_URL`; empty means no database.
 * @returns the `--patch` arguments, or none when a database is configured.
 */
export function noPostgresPatchArgs(databaseUrl: string): string[] {
  const skip = process.env.CLUSTER_WEB_SKIP_OVERLAYS === '1' || databaseUrl === ''
  return skip ? ['--patch', NO_POSTGRES_PATCH] : []
}

export function spawnLogged(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
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

export function waitForLine(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<string> {
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
      reject(new Error(`cluster-web: timed out waiting for ${pattern}`))
    }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
    }
    child.stdout?.on('data', onData)
  })
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

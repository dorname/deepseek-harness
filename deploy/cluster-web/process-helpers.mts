/**
 * Shared spawn/wait helpers for cluster-web frontend/api/supervise trees.
 *
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..')
export const DSH_BIN_BUILT = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
export const DSH_BIN_SOURCE = join(REPO_ROOT, 'apps', 'cli', 'src', 'bin.ts')
export const EDGE_SCRIPT = join(HERE, 'edge.mts')
export const FORWARD_SCRIPT = join(HERE, 'forward.mts')
export const API_OVERLAY_TEMPLATE = join(HERE, 'overlays', 'api.overlay.yml')
export const SHELL_OVERLAY_TEMPLATE = join(HERE, 'overlays', 'shell.overlay.yml')

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

export function renderOverlay(templatePath: string, vars: Record<string, string>, outPath: string): void {
  let text = readFileSync(templatePath, 'utf8')
  for (const [key, value] of Object.entries(vars)) {
    text = text.split(key).join(value)
  }
  writeFileSync(outPath, text)
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

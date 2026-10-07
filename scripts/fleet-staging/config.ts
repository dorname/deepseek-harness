/**
 * Local staging deployment configuration for the User Fleet topology
 * (change `user-fleet-gateway`): fleet manager + gateway over a loopback OIDC
 * test provider. Values live in `staging.config.json` next to this module so
 * every deployment-varying knob (concurrency cap, recycle timing, CPU
 * threshold) stays a deployment decision, never a hardcoded constant.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, derived from this module's location. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Path of the default staging deployment configuration file. */
const DEFAULT_CONFIG_PATH = join(REPO_ROOT, 'scripts', 'fleet-staging', 'staging.config.json')

/** Built dsh CLI entry the fleet manager launches per user. */
export const DSH_CLI_BIN = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')

/** Raw deployment configuration as written in `staging.config.json`. */
export interface RawStagingConfig {
  /** Filesystem root for state, lifecycle logs, and user homes; `null` defaults to `<tmpdir>/dsh-fleet-staging`. */
  stagingRoot: string | null
  /** Fleet manager concurrency cap; staging deliberately runs a small limit. */
  maxUsers: number
  /** Idle duration before a user process is recycled. */
  idleRecycleMs: number
  /** Crash restarts allowed within the restart window. */
  maxRestarts: number
  /** Sliding crash-restart window. */
  restartWindowMs: number
  /** SIGTERM grace before a recycling process is killed. */
  stopTimeoutMs: number
  /** How long a spawned user process may take to report its port. */
  portReadyTimeoutMs: number
  /** Host CPU utilization ceiling (percent) for acceptance and smoke runs. */
  cpuThresholdPercent: number
  /** OIDC provider binding; a `null` issuer means the in-process test provider. */
  oidc: { issuer: string | null; clientId: string; clientSecret: string }
}

/** Resolved staging configuration with every path and default materialized. */
export interface StagingConfig {
  /** Filesystem root holding state, logs, and homes. */
  stagingRoot: string
  /** Per-user `$DSH_HOME` root shared by the manager and the gateway. */
  homesDir: string
  /** Deployment state file recording the running topology. */
  statePath: string
  /** JSONL file receiving one structured lifecycle event per line. */
  lifecycleLogPath: string
  /** Remaining fleet manager fields, verbatim from the deployment config. */
  maxUsers: number
  idleRecycleMs: number
  maxRestarts: number
  restartWindowMs: number
  stopTimeoutMs: number
  portReadyTimeoutMs: number
  /** Host CPU utilization ceiling (percent) for acceptance and smoke runs. */
  cpuThresholdPercent: number
  /** Command launching one user's dsh web process; the manager appends `--port 0`. */
  dshCommand: readonly string[]
  /** OIDC binding; issuer is empty while the in-process test provider serves. */
  oidc: { issuer: string; clientId: string; clientSecret: string }
}

function requireNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`fleet-staging: config field ${field} must be a positive number, got ${String(value)}`)
  }
  return value
}

function requireString(source: Record<string, unknown>, field: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`fleet-staging: config field ${field} must be a non-empty string`)
  }
  return value
}

/**
 * Load and validate the staging deployment configuration.
 * @param path - configuration file; defaults to the checked-in staging config,
 * overridable through `FLEET_STAGING_CONFIG` for alternate deployments.
 * @returns the resolved configuration with derived paths and launch command.
 */
export function loadStagingConfig(path: string = process.env.FLEET_STAGING_CONFIG ?? DEFAULT_CONFIG_PATH): StagingConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const stagingRoot = typeof raw.stagingRoot === 'string' && raw.stagingRoot.length > 0
    ? resolve(raw.stagingRoot)
    : join(tmpdir(), 'dsh-fleet-staging')
  const oidc = raw.oidc
  if (typeof oidc !== 'object' || oidc === null) {
    throw new Error('fleet-staging: config field oidc must be an object')
  }
  const oidcRecord = oidc as Record<string, unknown>
  const issuer = typeof oidcRecord.issuer === 'string' ? oidcRecord.issuer : ''
  return {
    stagingRoot,
    homesDir: join(stagingRoot, 'homes'),
    statePath: join(stagingRoot, 'state.json'),
    lifecycleLogPath: join(stagingRoot, 'lifecycle.jsonl'),
    maxUsers: requireNumber(raw, 'maxUsers'),
    idleRecycleMs: requireNumber(raw, 'idleRecycleMs'),
    maxRestarts: requireNumber(raw, 'maxRestarts'),
    restartWindowMs: requireNumber(raw, 'restartWindowMs'),
    stopTimeoutMs: requireNumber(raw, 'stopTimeoutMs'),
    portReadyTimeoutMs: requireNumber(raw, 'portReadyTimeoutMs'),
    cpuThresholdPercent: requireNumber(raw, 'cpuThresholdPercent'),
    dshCommand: ['node', DSH_CLI_BIN, '--profile', 'web', '--trust-loopback-gateway'],
    oidc: { issuer, clientId: requireString(oidcRecord, 'clientId'), clientSecret: requireString(oidcRecord, 'clientSecret') },
  }
}

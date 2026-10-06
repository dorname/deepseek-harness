/**
 * Fleet manager deployment configuration.
 *
 * Every value is a deployment-varying choice, so each is a validated config
 * field resolved through {@link resolveFleetManagerConfig} — misconfiguration
 * fails loud at resolve time, never silently at runtime.
 *
 * @module
 */

/**
 * Valid subject pattern for per-user home directory names. A fleet subject is
 * the OIDC identity claim routed by the gateway; restricting it to filesystem-
 * safe characters keeps each user's `$DSH_HOME` inside the configured homes
 * root (no traversal, no escaping separators).
 */
export const FLEET_SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Complete, validated fleet manager configuration. */
export interface FleetManagerConfig {
  /** Directory root under which each user's `$DSH_HOME` is created as `<homesDir>/<subject>`. */
  homesDir: string
  /** Command used to launch one user's dsh web process; port 0 (OS-assigned) is appended. */
  dshCommand: readonly string[]
  /** Maximum number of concurrently alive user processes; excess logins are rejected with `rejected(limit)`. */
  maxUsers: number
  /** Idle duration after which an unused user process is recycled (its home is kept). */
  idleRecycleMs: number
  /** Crash restarts allowed within {@link restartWindowMs} before the process is declared failed. */
  maxRestarts: number
  /** Sliding window that bounds the crash restart count. */
  restartWindowMs: number
  /** Grace period for SIGTERM during recycling before escalation to SIGKILL. */
  stopTimeoutMs: number
  /** How long to wait for a spawned process to report its OS-assigned port before failing loud. */
  portReadyTimeoutMs: number
}

/**
 * Resolve a complete configuration from partial input, applying documented
 * defaults and validating every field.
 * @param input - deployment-provided values; every field is optional here.
 * @returns the complete configuration with defaults applied.
 * @throws when any provided value violates its field contract.
 */
export function resolveFleetManagerConfig(input: Partial<FleetManagerConfig> = {}): FleetManagerConfig {
  const config: FleetManagerConfig = {
    homesDir: input.homesDir ?? '',
    dshCommand: input.dshCommand ?? ['dsh', '--profile', 'web'],
    maxUsers: input.maxUsers ?? 8,
    idleRecycleMs: input.idleRecycleMs ?? 30 * 60_000,
    maxRestarts: input.maxRestarts ?? 3,
    restartWindowMs: input.restartWindowMs ?? 60_000,
    stopTimeoutMs: input.stopTimeoutMs ?? 10_000,
    portReadyTimeoutMs: input.portReadyTimeoutMs ?? 60_000,
  }
  if (config.homesDir.length === 0) {
    throw new Error('fleet-manager: homesDir is required')
  }
  if (config.dshCommand.length === 0) {
    throw new Error('fleet-manager: dshCommand must not be empty')
  }
  if (!Number.isInteger(config.maxUsers) || config.maxUsers < 1) {
    throw new Error(`fleet-manager: maxUsers must be an integer >= 1, got ${config.maxUsers}`)
  }
  if (!Number.isFinite(config.idleRecycleMs) || config.idleRecycleMs <= 0) {
    throw new Error(`fleet-manager: idleRecycleMs must be > 0, got ${config.idleRecycleMs}`)
  }
  if (!Number.isInteger(config.maxRestarts) || config.maxRestarts < 0) {
    throw new Error(`fleet-manager: maxRestarts must be an integer >= 0, got ${config.maxRestarts}`)
  }
  for (const field of ['restartWindowMs', 'stopTimeoutMs', 'portReadyTimeoutMs'] as const) {
    if (!Number.isFinite(config[field]) || config[field] <= 0) {
      throw new Error(`fleet-manager: ${field} must be > 0, got ${config[field]}`)
    }
  }
  return config
}

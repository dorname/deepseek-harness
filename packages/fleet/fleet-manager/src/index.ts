/**
 * Per-user dsh process registry for User Fleet deployments.
 *
 * The fleet manager provisions one `dsh --profile web` process per logged-in
 * user with that user's dedicated `$DSH_HOME`, recycles idle processes while
 * keeping their data, restarts crashed processes within a bounded window,
 * and enforces the deployment's concurrency limit. Deployments run it as
 * their process authority; the gateway consults it on every login.
 *
 * @module @deepseek-ai/dsh-fleet-manager
 */

export { FLEET_SUBJECT_PATTERN, resolveFleetManagerConfig } from './config.ts'
export type { FleetManagerConfig } from './config.ts'
export { spawnDshWebProcess } from './process.ts'
export type { FleetProcess, FleetProcessSpec, FleetProcessSpawner, SpawnDshWebOptions } from './process.ts'
export { FleetManager } from './fleet-manager.ts'
export type {
  EnsureOutcome,
  FleetLogger,
  FleetManagerOptions,
  LifecycleEvent,
  LifecycleEventKind,
} from './fleet-manager.ts'

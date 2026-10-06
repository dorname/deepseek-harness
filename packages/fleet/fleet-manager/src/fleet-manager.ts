/**
 * The fleet manager: one registry of per-user dsh web processes.
 *
 * The manager owns the whole per-user process lifecycle — lazy provisioning
 * on first login, idle recycling that keeps the user's `$DSH_HOME`, crash
 * restarts bounded by a sliding window, and a hard concurrency limit so a
 * burst of logins can never oversubscribe the host. Every transition emits a
 * structured lifecycle event (`provisioned` / `recycled` / `restarted` /
 * `rejected` / `failed` / `stopped`) for fleet operators.
 *
 * Isolation invariants (change `user-fleet-gateway`): one user owns exactly
 * one process and one home; recycling terminates the process but never
 * touches its home; the concurrency limit is enforced here, not by the
 * caller.
 *
 * @module
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { FLEET_SUBJECT_PATTERN, resolveFleetManagerConfig } from './config.ts'
import type { FleetManagerConfig } from './config.ts'
import type { FleetProcess, FleetProcessSpec, FleetProcessSpawner } from './process.ts'

/** Structured lifecycle events emitted for fleet operators. */
export type LifecycleEventKind =
  | 'provisioned'
  | 'recycled'
  | 'restarted'
  | 'rejected'
  | 'failed'
  | 'stopped'

/** One structured lifecycle record. */
export interface LifecycleEvent {
  /** Transition kind. */
  kind: LifecycleEventKind
  /** Fleet subject the event belongs to. */
  subject: string
  /** Transition-specific detail (e.g. the recycle trigger). */
  detail?: string
}

/** Logger seam; the default writes one JSON line per event to stdout. */
export type FleetLogger = (event: LifecycleEvent) => void

/** Result of {@link FleetManager.ensureProcess}. */
export type EnsureOutcome =
  | { kind: 'ready'; subject: string; port: number; home: string }
  | { kind: 'rejected'; subject: string; reason: 'limit' }

interface RegisteredProcess {
  subject: string
  home: string
  process: FleetProcess
  lastActiveAt: number
  stopping: boolean
}

/** Construction seams; every field has a production default. */
export interface FleetManagerOptions {
  /** Spawner for user processes; defaults to the production `dsh --profile web` spawner. */
  spawner?: FleetProcessSpawner
  /** Monotonic-ish clock in milliseconds; defaults to `Date.now` (test seam). */
  now?: () => number
  /** Lifecycle event sink; defaults to JSON lines on stdout. */
  logger?: FleetLogger
}

/**
 * Registry and lifecycle owner for the fleet's user processes. Construct
 * with a resolved {@link FleetManagerConfig}; call {@link startRecycleLoop}
 * to enable background recycling and {@link dispose} to stop it and every
 * user process.
 */
export class FleetManager {
  private readonly config: FleetManagerConfig
  private readonly spawner: FleetProcessSpawner
  private readonly now: () => number
  private readonly logger: FleetLogger
  private readonly processes = new Map<string, RegisteredProcess>()
  /** Crash exit timestamps per subject across process generations, oldest first. */
  private readonly restartsBySubject = new Map<string, number[]>()
  private recycleTimer: NodeJS.Timeout | undefined

  constructor(config: Partial<FleetManagerConfig>, options: FleetManagerOptions = {}) {
    this.config = resolveFleetManagerConfig(config)
    this.spawner = options.spawner ?? defaultSpawner(this.config)
    this.now = options.now ?? Date.now
    this.logger = options.logger ?? defaultLogger
  }

  /** Subjects with a registered process (starting, ready, or restarting). */
  listActive(): string[] {
    return [...this.processes.keys()]
  }

  /** Observation handle for one subject's registered process, or `undefined`. */
  processInfo(subject: string): { port: number; pid: number | undefined; home: string; launchUrl: string } | undefined {
    const registered = this.processes.get(subject)
    if (registered === undefined) {
      return undefined
    }
    return {
      port: registered.process.port,
      pid: registered.process.pid,
      home: registered.home,
      launchUrl: registered.process.launchUrl,
    }
  }

  /**
   * Ensure the subject's process is running, provisioning it lazily on first
   * login. An in-registry process is touched and returned; an unknown
   * subject is admitted only while the registry holds fewer than
   * `maxUsers` processes.
   * @param subject - the authenticated fleet subject.
   * @returns the process coordinates when admitted, or `rejected` once the
   * concurrency limit is reached.
   * @throws when the subject is not a filesystem-safe fleet subject, or the
   * new process fails to start.
   */
  async ensureProcess(subject: string): Promise<EnsureOutcome> {
    if (!FLEET_SUBJECT_PATTERN.test(subject)) {
      throw new Error(`fleet-manager: invalid fleet subject ${JSON.stringify(subject)}`)
    }
    const existing = this.processes.get(subject)
    if (existing !== undefined) {
      existing.lastActiveAt = this.now()
      return { kind: 'ready', subject, port: existing.process.port, home: existing.home }
    }
    if (this.processes.size >= this.config.maxUsers) {
      this.emit({ kind: 'rejected', subject, detail: `concurrency limit ${this.config.maxUsers} reached` })
      return { kind: 'rejected', subject, reason: 'limit' }
    }
    const ready = await this.launch(subject)
    return { kind: 'ready', subject, ...ready }
  }

  /** Mark a subject's process active, deferring idle recycling. */
  touch(subject: string): void {
    const registered = this.processes.get(subject)
    if (registered !== undefined) {
      registered.lastActiveAt = this.now()
    }
  }

  /**
   * Recycle every process idle for at least `idleRecycleMs`, keeping its
   * home. Safe to drive manually or from {@link startRecycleLoop}.
   * @returns the subjects whose recycling was initiated.
   */
  async recycleIdle(): Promise<string[]> {
    const now = this.now()
    const due = [...this.processes.values()]
      .filter(registered => !registered.stopping && now - registered.lastActiveAt >= this.config.idleRecycleMs)
      .map(registered => registered.subject)
    for (const subject of due) {
      await this.stopProcess(subject, 'idle')
    }
    return due
  }

  /** Start the background idle-recycling loop at the configured cadence. */
  startRecycleLoop(): void {
    if (this.recycleTimer === undefined) {
      this.recycleTimer = setInterval(() => {
        void this.recycleIdle()
      }, this.config.idleRecycleMs)
    }
  }

  /**
   * Stop the recycle loop and every user process, keeping all homes.
   * Idempotent; the manager must not be used after this resolves.
   */
  async dispose(): Promise<void> {
    if (this.recycleTimer !== undefined) {
      clearInterval(this.recycleTimer)
      this.recycleTimer = undefined
    }
    for (const subject of [...this.processes.keys()]) {
      await this.stopProcess(subject, 'shutdown')
    }
  }

  private emit(event: LifecycleEvent): void {
    this.logger(event)
  }

  private async launch(subject: string, isRestart = false): Promise<{ port: number; home: string }> {
    const home = join(this.config.homesDir, subject)
    mkdirSync(home, { recursive: true })
    const registered: RegisteredProcess = {
      subject,
      home,
      process: await this.spawner({ subject, home }),
      lastActiveAt: this.now(),
      stopping: false,
    }
    this.processes.set(subject, registered)
    registered.process.onExit((exit) => {
      void this.handleExit(registered, exit)
    })
    this.emit({ kind: isRestart ? 'restarted' : 'provisioned', subject, detail: `port ${registered.process.port}` })
    return { port: registered.process.port, home }
  }

  private async handleExit(registered: RegisteredProcess, exit: { code: number | null; signal: NodeJS.Signals | null }): Promise<void> {
    if (registered.stopping) {
      return
    }
    const now = this.now()
    const restarts = (this.restartsBySubject.get(registered.subject) ?? []).filter(at => now - at < this.config.restartWindowMs)
    restarts.push(now)
    if (restarts.length > this.config.maxRestarts) {
      this.processes.delete(registered.subject)
      this.restartsBySubject.delete(registered.subject)
      this.emit({
        kind: 'failed',
        subject: registered.subject,
        detail: `exceeded ${this.config.maxRestarts} restarts within ${this.config.restartWindowMs}ms (code ${exit.code}, signal ${exit.signal})`,
      })
      return
    }
    this.restartsBySubject.set(registered.subject, restarts)
    await this.launch(registered.subject, true)
  }

  private async stopProcess(subject: string, detail: string): Promise<void> {
    const registered = this.processes.get(subject)
    if (registered === undefined) {
      return
    }
    registered.stopping = true
    try {
      await registered.process.stop()
    } finally {
      this.processes.delete(subject)
      // A deliberate stop starts a fresh crash budget for the next login.
      this.restartsBySubject.delete(subject)
    }
    this.emit({ kind: detail === 'idle' ? 'recycled' : 'stopped', subject, detail })
  }
}

function defaultSpawner(config: FleetManagerConfig): FleetProcessSpawner {
  // Imported lazily so test builds can construct a manager without pulling
  // node:child_process into the entry graph evaluation.
  return async (spec: FleetProcessSpec) => {
    const { spawnDshWebProcess } = await import('./process.ts')
    return spawnDshWebProcess(spec, {
      dshCommand: config.dshCommand,
      portReadyTimeoutMs: config.portReadyTimeoutMs,
    })
  }
}

function defaultLogger(event: LifecycleEvent): void {
  console.log(JSON.stringify(event))
}

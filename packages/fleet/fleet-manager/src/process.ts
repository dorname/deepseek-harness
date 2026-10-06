/**
 * The one user dsh web process, as observed by the fleet manager.
 *
 * {@link spawnDshWebProcess} is the production spawner: it launches
 * `dsh --profile web` with an OS-assigned port (`--port 0`), the user's
 * dedicated `$DSH_HOME`, and the fleet subject used for audit attribution,
 * then resolves once the process prints its loopback URL. The
 * {@link FleetProcess} interface is the seam tests and alternate hosts
 * substitute.
 *
 * @module
 */

import { spawn } from 'node:child_process'

/** Spec handed to a spawner: who the process belongs to and where its data lives. */
export interface FleetProcessSpec {
  /** Fleet subject owning the process; injected as `DSH_FLEET_USER_ID` for audit attribution. */
  subject: string
  /** The user's dedicated `$DSH_HOME` directory. */
  home: string
}

/** One running user process: its OS-assigned loopback port plus lifecycle control. */
export interface FleetProcess {
  /** Loopback port the process is serving on. */
  readonly port: number
  /**
   * The process's printed ready URL, carrying its launch token's query
   * parameter. Loopback-only material: the gateway exchanges it for a
   * browser-session cookie from the loopback side and never forwards it
   * outward.
   */
  readonly launchUrl: string
  /** Process id, when the platform exposes one (used by crash-injection tests). */
  readonly pid: number | undefined
  /**
   * Request graceful stop; resolves once the process has exited. Escalating
   * to SIGKILL after a grace period is the manager's concern.
   */
  stop(): Promise<void>
  /** Register a listener for an exit the manager did not request. */
  onExit(listener: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void): void
}

/** Spawner seam: produces one {@link FleetProcess} for a user spec. */
export type FleetProcessSpawner = (spec: FleetProcessSpec) => Promise<FleetProcess>

/** Options for {@link spawnDshWebProcess}. */
export interface SpawnDshWebOptions {
  /** Command to launch; defaults to `dsh --profile web`. */
  dshCommand?: readonly string[]
  /** Environment beyond the base process environment (`DSH_HOME` and `DSH_FLEET_USER_ID` are always set). */
  env?: NodeJS.ProcessEnv
  /** Milliseconds to wait for the loopback URL before failing loud. */
  portReadyTimeoutMs?: number
}

/** Matches the loopback URL line printed by `dsh web`: port plus any query (the launch token). */
const URL_PATTERN = /http:\/\/127\.0\.0\.1:(\d+)\/?\S*/

/**
 * Spawn one user's `dsh --profile web` process with its dedicated home and
 * fleet identity, resolving with a {@link FleetProcess} once it reports its
 * OS-assigned port.
 * @param spec - the user's subject and home directory.
 * @param options - command, environment, and readiness-timeout overrides.
 * @returns the running process handle.
 * @throws when the command is empty, the process exits before printing a
 * loopback URL, or fails to print one within the readiness timeout.
 */
export function spawnDshWebProcess(spec: FleetProcessSpec, options: SpawnDshWebOptions = {}): Promise<FleetProcess> {
  const [file, ...commandArgs] = options.dshCommand ?? ['dsh', '--profile', 'web']
  const timeoutMs = options.portReadyTimeoutMs ?? 60_000
  return new Promise<FleetProcess>((resolveSpawn, rejectSpawn) => {
    if (file === undefined) {
      rejectSpawn(new Error('fleet-manager: dshCommand must name an executable'))
      return
    }
    const child = spawn(file, [...commandArgs, '--port', '0'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        ...options.env,
        DSH_HOME: spec.home,
        DSH_FLEET_USER_ID: spec.subject,
      },
    })
    let settled = false
    let stdout = ''
    let exitListener: ((exit: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined
    let stopRequested = false
    const readiness: { timer?: NodeJS.Timeout } = {}
    // The promise settle functions are idempotent, so late duplicates only
    // need to record the outcome and stop paying for the readiness timer.
    const fail = (error: Error): void => {
      settled = true
      clearTimeout(readiness.timer)
      child.kill('SIGKILL')
      rejectSpawn(error)
    }
    const becomeReady = (port: number, launchUrl: string): void => {
      settled = true
      clearTimeout(readiness.timer)
      resolveSpawn({
        port,
        launchUrl,
        pid: child.pid,
        stop: () =>
          new Promise<void>((resolveStop, rejectStop) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolveStop()
              return
            }
            child.once('exit', () => {
              resolveStop()
            })
            stopRequested = true
            child.once('error', rejectStop)
            child.kill('SIGTERM')
          }),
        onExit: (listener) => {
          exitListener = listener
        },
      })
    }
    readiness.timer = setTimeout(() => {
      fail(new Error(`fleet-manager: dsh web process for ${spec.subject} printed no loopback URL within ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      const match = URL_PATTERN.exec(stdout)
      if (match !== null) {
        becomeReady(Number(match[1]), match[0])
      }
    })
    child.once('exit', (code, signal) => {
      if (!settled) {
        fail(new Error(`fleet-manager: dsh web process for ${spec.subject} exited before reporting a port (code ${code}, signal ${signal})`))
        return
      }
      if (!stopRequested) {
        exitListener?.({ code, signal })
      }
    })
    child.once('error', (error) => {
      fail(error)
    })
  })
}

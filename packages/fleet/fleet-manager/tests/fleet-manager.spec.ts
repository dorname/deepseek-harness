import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveFleetManagerConfig } from '../src/config.ts'
import { FleetManager } from '../src/fleet-manager.ts'
import type { EnsureOutcome, LifecycleEvent } from '../src/fleet-manager.ts'
import { spawnDshWebProcess } from '../src/process.ts'
import type { FleetProcess, FleetProcessSpawner } from '../src/process.ts'
import { reportResult } from './helpers/reporter.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fleet-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  vi.useRealTimers()
})

/** Controllable clock for idle-recycling and restart-window tests. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000_000
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

/** Narrow a provisioning outcome to its ready coordinates. */
function expectReady(outcome: EnsureOutcome): { subject: string; port: number; home: string } {
  if (outcome.kind !== 'ready') {
    throw new Error(`expected a ready process, got ${outcome.kind} (${outcome.reason})`)
  }
  return outcome
}

/** In-memory process double with an injectable crash. */
class FakeFleetProcess implements FleetProcess {
  readonly port: number
  readonly launchUrl: string
  readonly pid: number | undefined
  private readonly exitListeners: Array<(exit: { code: number | null; signal: NodeJS.Signals | null }) => void> = []

  constructor(port: number) {
    this.port = port
    this.launchUrl = `http://127.0.0.1:${String(port)}/?token=fake-${String(port)}`
    this.pid = 1000 + port
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  onExit(listener: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void): void {
    this.exitListeners.push(listener)
  }

  crash(code: number | null = 1): void {
    for (const listener of this.exitListeners) {
      listener({ code, signal: null })
    }
  }
}

/** Process double that reports an exit through `stop()` itself, modeling an exit in flight during a deliberate stop. */
class StopNotifyingFleetProcess implements FleetProcess {
  readonly port = 4000
  readonly launchUrl = 'http://127.0.0.1:4000/?token=fake-4000'
  readonly pid: number = 4001
  private readonly exitListeners: Array<(exit: { code: number | null; signal: NodeJS.Signals | null }) => void> = []

  stop(): Promise<void> {
    for (const listener of this.exitListeners) {
      listener({ code: 0, signal: null })
    }
    return Promise.resolve()
  }

  onExit(listener: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void): void {
    this.exitListeners.push(listener)
  }
}

function fakeSpawner(): { spawner: FleetProcessSpawner; processes: FakeFleetProcess[] } {
  const processes: FakeFleetProcess[] = []
  return {
    processes,
    spawner: (spec) => {
      mkdirSync(spec.home, { recursive: true })
      const process = new FakeFleetProcess(3000 + processes.length)
      processes.push(process)
      return Promise.resolve(process)
    },
  }
}

interface Harness {
  manager: FleetManager
  events: LifecycleEvent[]
  clock: ReturnType<typeof fakeClock>
  spawner: ReturnType<typeof fakeSpawner>
}

function harness(config: { maxUsers?: number; idleRecycleMs?: number; maxRestarts?: number } = {}): Harness {
  const events: LifecycleEvent[] = []
  const clock = fakeClock()
  const spawner = fakeSpawner()
  const manager = new FleetManager(
    {
      homesDir: tempDir(),
      idleRecycleMs: config.idleRecycleMs ?? 1_000,
      maxUsers: config.maxUsers,
      maxRestarts: config.maxRestarts,
      restartWindowMs: 10_000,
    },
    {
      spawner: spawner.spawner,
      now: clock.now,
      logger: (event) => {
        events.push(event)
      },
    },
  )
  return { manager, events, clock, spawner }
}

function lastEvent(h: Harness, kind: string): LifecycleEvent | undefined {
  return [...h.events].reverse().find(event => event.kind === kind)
}

describe('resolveFleetManagerConfig', () => {
  it('applies documented defaults and keeps provided values', () => {
    const config = resolveFleetManagerConfig({ homesDir: '/data/homes' })
    expect(config.homesDir).toBe('/data/homes')
    expect(config.maxUsers).toBe(8)
    expect(config.idleRecycleMs).toBe(30 * 60_000)
    expect(config.maxRestarts).toBe(3)
    expect(config.dshCommand).toEqual(['dsh', '--profile', 'web'])
  })

  it('fails loud on every invalid field', () => {
    expect(() => resolveFleetManagerConfig({})).throws('homesDir is required')
    expect(() => resolveFleetManagerConfig({ homesDir: '/h', dshCommand: [] })).throws('dshCommand')
    expect(() => resolveFleetManagerConfig({ homesDir: '/h', maxUsers: 0 })).throws('maxUsers')
    expect(() => resolveFleetManagerConfig({ homesDir: '/h', idleRecycleMs: 0 })).throws('idleRecycleMs')
    expect(() => resolveFleetManagerConfig({ homesDir: '/h', maxRestarts: -1 })).throws('maxRestarts')
    expect(() => resolveFleetManagerConfig({ homesDir: '/h', restartWindowMs: 0 })).throws('restartWindowMs')
    expect(() => resolveFleetManagerConfig({ homesDir: '/h', stopTimeoutMs: 0 })).throws('stopTimeoutMs')
    expect(() => resolveFleetManagerConfig({ homesDir: '/h', portReadyTimeoutMs: 0 })).throws('portReadyTimeoutMs')
  })
})

describe('FleetManager lifecycle (in-memory process double)', () => {
  it('UT-S33-01 recycles an idle process and keeps its home', async () => {
    const start = Date.now()
    try {
      const h = harness()
      const first = expectReady(await h.manager.ensureProcess('user-a'))
      writeFileSync(join(first.home, 'session.v4.jsonl'), 'events\n')

      h.clock.advance(1_000)
      expect(await h.manager.recycleIdle()).toEqual(['user-a'])
      expect(existsSync(join(first.home, 'session.v4.jsonl'))).toBe(true)
      expect(h.manager.listActive()).toEqual([])
      expect(lastEvent(h, 'recycled')?.subject).toBe('user-a')
      reportResult('UT-S33-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S33-01', 'fail', String(error), Date.now() - start)
      throw error
    }
  })

  it('UT-S33-02 restarts a crashed process within the window', async () => {
    const start = Date.now()
    try {
      const h = harness()
      const first = expectReady(await h.manager.ensureProcess('user-a'))
      h.spawner.processes[0]!.crash()
      await vi.waitFor(() => {
        expect(h.spawner.processes.length).toBe(2)
      })

      expect(h.manager.listActive()).toEqual(['user-a'])
      expect(lastEvent(h, 'restarted')?.subject).toBe('user-a')
      const second = expectReady(await h.manager.ensureProcess('user-a'))
      expect(second.port).toBe(first.port + 1)
      reportResult('UT-S33-02', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S33-02', 'fail', String(error), Date.now() - start)
      throw error
    }
  })

  it('UT-S33-03 rejects provisioning once the concurrency limit is reached', async () => {
    const start = Date.now()
    try {
      const h = harness({ maxUsers: 1 })
      await h.manager.ensureProcess('user-a')
      expect(await h.manager.ensureProcess('user-b')).toEqual({ kind: 'rejected', subject: 'user-b', reason: 'limit' })
      expect(h.manager.listActive()).toEqual(['user-a'])
      expect(lastEvent(h, 'rejected')?.subject).toBe('user-b')
      reportResult('UT-S33-03', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S33-03', 'fail', String(error), Date.now() - start)
      throw error
    }
  })

  it('fails loud on an invalid fleet subject', async () => {
    const h = harness()
    await expect(h.manager.ensureProcess('../escape')).rejects.toThrow('invalid fleet subject')
    await expect(h.manager.ensureProcess('a/b')).rejects.toThrow('invalid fleet subject')
  })

  it('returns the registered process and refreshes activity for a known subject', async () => {
    const h = harness()
    const first = await h.manager.ensureProcess('user-a')
    h.clock.advance(900)
    h.manager.touch('user-a')
    expect(await h.manager.ensureProcess('user-a')).toEqual(first)
    h.clock.advance(900)
    expect(await h.manager.recycleIdle()).toEqual([])
  })

  it('touch on an unknown subject is a no-op', () => {
    const h = harness()
    expect(() => {
      h.manager.touch('ghost')
    }).not.toThrow()
    expect(h.manager.processInfo('ghost')).toBeUndefined()
  })

  it('does not restart a process whose exit arrives through a deliberate stop', async () => {
    const h = harness()
    const events: LifecycleEvent[] = []
    const spawner: FleetProcessSpawner = (spec) => {
      mkdirSync(spec.home, { recursive: true })
      return Promise.resolve(new StopNotifyingFleetProcess())
    }
    const manager = new FleetManager(
      { homesDir: tempDir(), idleRecycleMs: 60_000 },
      {
        spawner,
        now: h.clock.now,
        logger: (event) => {
          events.push(event)
        },
      },
    )
    await manager.ensureProcess('user-a')

    h.clock.advance(60_000)
    await manager.recycleIdle()

    expect(events.some(event => event.kind === 'restarted')).toBe(false)
    expect([...events].reverse().find(event => event.kind === 'recycled')?.subject).toBe('user-a')
    expect(manager.listActive()).toEqual([])
    await manager.dispose()
  })

  it('skips recycling a subject that failed while the recycle pass was draining', async () => {
    const h = harness({ maxRestarts: 0 })
    await h.manager.ensureProcess('user-a')
    await h.manager.ensureProcess('user-b')
    h.clock.advance(1_000)

    const recycling = h.manager.recycleIdle()
    h.spawner.processes[1]!.crash()
    await recycling

    expect(lastEvent(h, 'failed')?.subject).toBe('user-b')
    expect(h.events.some(event => event.kind === 'recycled' && event.subject === 'user-b')).toBe(false)
    expect(h.manager.listActive()).toEqual([])
  })

  it('declares a process failed after exceeding the restart budget in the window', async () => {
    const h = harness({ maxRestarts: 2 })
    await h.manager.ensureProcess('user-a')
    h.spawner.processes[0]!.crash()
    await vi.waitFor(() => {
      expect(h.spawner.processes.length).toBe(2)
    })
    h.spawner.processes[1]!.crash()
    await vi.waitFor(() => {
      expect(h.spawner.processes.length).toBe(3)
    })
    h.spawner.processes[2]!.crash()
    await vi.waitFor(() => {
      expect(h.manager.listActive()).toEqual([])
    })
    expect(lastEvent(h, 'failed')?.subject).toBe('user-a')
  })

  it('restarts outside the window do not accumulate toward the budget', async () => {
    const h = harness({ maxRestarts: 2 })
    await h.manager.ensureProcess('user-a')
    h.spawner.processes[0]!.crash()
    await vi.waitFor(() => {
      expect(h.spawner.processes.length).toBe(2)
    })
    h.clock.advance(20_000)
    h.spawner.processes[1]!.crash()
    await vi.waitFor(() => {
      expect(h.spawner.processes.length).toBe(3)
    })
    h.clock.advance(20_000)
    h.spawner.processes[2]!.crash()
    await vi.waitFor(() => {
      expect(h.spawner.processes.length).toBe(4)
    })
    expect(h.manager.listActive()).toEqual(['user-a'])
    expect(lastEvent(h, 'failed')).toBeUndefined()
  })

  it('emits stopped and clears the registry on dispose, idempotently', async () => {
    const h = harness()
    await h.manager.ensureProcess('user-a')
    await h.manager.dispose()
    expect(h.manager.listActive()).toEqual([])
    expect(lastEvent(h, 'stopped')?.subject).toBe('user-a')
    await expect(h.manager.dispose()).resolves.toBeUndefined()
  })

  it('recycles idle processes on the background loop and stops the loop with dispose', async () => {
    vi.useFakeTimers()
    const events: LifecycleEvent[] = []
    const spawner = fakeSpawner()
    const manager = new FleetManager(
      { homesDir: tempDir(), idleRecycleMs: 1_000 },
      {
        spawner: spawner.spawner,
        logger: (event) => {
          events.push(event)
        },
      },
    )
    manager.startRecycleLoop()
    await manager.ensureProcess('user-a')
    await vi.advanceTimersByTimeAsync(2_100)
    expect(events.some(event => event.kind === 'recycled')).toBe(true)
    await manager.dispose()
    manager.startRecycleLoop()
    manager.startRecycleLoop()
    await manager.dispose()
  })
})

describe('ST-S33 fleet lifecycle scenarios (real child processes)', () => {
  const fakeDsh = fileURLToPath(new URL('./helpers/fake-dsh.mjs', import.meta.url))

  function realManager(): FleetManager {
    return new FleetManager({
      homesDir: tempDir(),
      dshCommand: [process.execPath, fakeDsh],
      idleRecycleMs: 400,
      stopTimeoutMs: 5_000,
      portReadyTimeoutMs: 10_000,
    })
  }

  async function probePort(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      return response.ok
    } catch {
      return false
    }
  }

  it('ST-S33-01 re-provisioning after recycling reuses the home and its sessions', async () => {
    const start = Date.now()
    try {
      const manager = realManager()
      const first = expectReady(await manager.ensureProcess('user-a'))
      writeFileSync(join(first.home, 'session.v4.jsonl'), 'recorded\n')

      await new Promise(resolve => setTimeout(resolve, 450))
      expect(await manager.recycleIdle()).toEqual(['user-a'])
      expect(existsSync(join(first.home, 'session.v4.jsonl'))).toBe(true)

      const second = expectReady(await manager.ensureProcess('user-a'))
      expect(second.home).toBe(first.home)
      expect(existsSync(join(first.home, 'session.v4.jsonl'))).toBe(true)
      await manager.dispose()
      reportResult('ST-S33-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('ST-S33-01', 'fail', String(error), Date.now() - start)
      throw error
    }
  }, 20_000)

  it('ST-S33-02 a crashed user process restarts while other users keep serving', async () => {
    const start = Date.now()
    try {
      const events: LifecycleEvent[] = []
      const manager = new FleetManager(
        {
          homesDir: tempDir(),
          dshCommand: [process.execPath, fakeDsh],
          stopTimeoutMs: 5_000,
          portReadyTimeoutMs: 10_000,
        },
        {
          logger: (event) => {
            events.push(event)
          },
        },
      )
      expectReady(await manager.ensureProcess('user-a'))
      const b = expectReady(await manager.ensureProcess('user-b'))
      const pidA = manager.processInfo('user-a')!.pid!
      const pidB = manager.processInfo('user-b')!.pid!

      process.kill(pidA, 'SIGKILL')
      await vi.waitFor(() => {
        expect(events.some(event => event.kind === 'restarted' && event.subject === 'user-a')).toBe(true)
      }, { timeout: 10_000, interval: 50 })

      const aAfter = manager.processInfo('user-a')!
      expect(aAfter.pid).not.toBe(pidA)
      expect(await probePort(aAfter.port)).toBe(true)
      expect(manager.processInfo('user-b')!.pid).toBe(pidB)
      expect(await probePort(b.port)).toBe(true)
      await manager.dispose()
      reportResult('ST-S33-02', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('ST-S33-02', 'fail', String(error), Date.now() - start)
      throw error
    }
  }, 25_000)
})

describe('spawnDshWebProcess (production spawner against the fake dsh)', () => {
  const fakeDsh = fileURLToPath(new URL('./helpers/fake-dsh.mjs', import.meta.url))
  const dshCommand = [process.execPath, fakeDsh]
  const home = () => tempDir()

  it('resolves the OS-assigned loopback port from the printed URL and serves it', async () => {
    const process = await spawnDshWebProcess({ subject: 'user-a', home: home() }, { dshCommand })
    expect(process.port).toBeGreaterThan(0)
    expect(process.launchUrl).toBe(`http://127.0.0.1:${String(process.port)}/?token=fake-user-a`)
    expect(await fetch(`http://127.0.0.1:${process.port}/`).then(response => response.ok)).toBe(true)
    await process.stop()
  })

  it('injects DSH_HOME and the fleet subject into the child environment', async () => {
    const process = await spawnDshWebProcess({ subject: 'user-a', home: home() }, { dshCommand })
    const body = await fetch(`http://127.0.0.1:${process.port}/`).then(response => response.text())
    expect(body).toBe('user-a ok\n')
    await process.stop()
  })

  it('fails loud when the child exits before printing a URL', async () => {
    await expect(
      spawnDshWebProcess({ subject: 'user-a', home: home() }, { dshCommand: [process.execPath, '-e', 'process.exit(3)'] }),
    ).rejects.toThrow('exited before reporting a port')
  })

  it('fails loud when no URL is printed within the readiness timeout', async () => {
    const silent = fileURLToPath(new URL('./helpers/fake-dsh-silent.mjs', import.meta.url))
    await expect(
      spawnDshWebProcess({ subject: 'user-a', home: home() }, { dshCommand: [process.execPath, silent], portReadyTimeoutMs: 50 }),
    ).rejects.toThrow('printed no loopback URL within 50ms')
  })

  it('fails loud when the command names no executable', async () => {
    await expect(
      spawnDshWebProcess({ subject: 'user-a', home: home() }, { dshCommand: [] }),
    ).rejects.toThrow('dshCommand must name an executable')
  })

  it('uses the production dsh command by default and fails loud when it cannot launch', async () => {
    await expect(
      spawnDshWebProcess({ subject: 'user-a', home: home() }, { portReadyTimeoutMs: 100 }),
    ).rejects.toThrow()
  })

  it('ignores stdout chunks that arrive after the loopback URL settled the spawn', async () => {
    const verbose = fileURLToPath(new URL('./helpers/fake-dsh-verbose.mjs', import.meta.url))
    const proc = await spawnDshWebProcess({ subject: 'user-a', home: home() }, { dshCommand: [process.execPath, verbose] })
    expect(proc.port).toBeGreaterThan(0)
    // Let the child's late stdout chunk land before stopping it.
    await new Promise(resolve => setTimeout(resolve, 50))
    await proc.stop()
  })

  it('stop resolves immediately for an already-exited process', async () => {
    const process = await spawnDshWebProcess({ subject: 'user-a', home: home() }, { dshCommand })
    await process.stop()
    await expect(process.stop()).resolves.toBeUndefined()
  })
})

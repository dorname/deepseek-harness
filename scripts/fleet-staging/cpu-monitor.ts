/**
 * Host CPU utilization sampler for acceptance and smoke runs
 * (ST-S33-03 / SMOKE-core-11): reads `/proc/stat` on a fixed cadence and
 * tracks the peak whole-host utilization percentage. The monitor is a
 * precondition of the CPU-constrained acceptance, so a platform without
 * `/proc/stat` fails loud instead of silently skipping the constraint.
 *
 * @module
 */

import { readFileSync } from 'node:fs'

/** One running CPU sampler. */
export interface CpuMonitor {
  /** Highest whole-host utilization observed so far, in percent (0-100). */
  peakPercent(): number
  /** Stop the sampling timer. */
  stop(): void
}

interface CpuTicks {
  idle: number
  total: number
}

/** Parse the aggregate `cpu` line of `/proc/stat`; undefined when absent. */
function sampleOnce(): CpuTicks | undefined {
  let line: string | undefined
  try {
    line = readFileSync('/proc/stat', 'utf8')
      .split('\n')
      .find(candidate => candidate.startsWith('cpu '))
  } catch {
    return undefined
  }
  if (line === undefined) return undefined
  const ticks = line.trim().split(/\s+/).slice(1).map(Number)
  if (ticks.length < 5 || ticks.some(value => !Number.isFinite(value))) return undefined
  const [user, nice, system, idle, iowait, irq = 0, softirq = 0, steal = 0] = ticks
  if (user === undefined || nice === undefined || system === undefined || idle === undefined || iowait === undefined) {
    return undefined
  }
  const total = user + nice + system + idle + iowait + irq + softirq + steal
  return { idle: idle + iowait, total }
}

/**
 * Start sampling host CPU utilization.
 * @param intervalMs - sampling cadence; utilization is measured between
 * consecutive ticks, so the first sample only baselines.
 * @returns the running monitor; call {@link CpuMonitor.stop} when done.
 * @throws when `/proc/stat` is unavailable (the CPU constraint is unmonitorable).
 */
export function startCpuMonitor(intervalMs = 500): CpuMonitor {
  const first = sampleOnce()
  if (first === undefined) {
    throw new Error('fleet-staging: /proc/stat is unavailable; the CPU acceptance constraint cannot be monitored')
  }
  let previous = first
  let peak = 0
  const timer = setInterval(() => {
    const next = sampleOnce()
    if (next === undefined) return
    const totalDelta = next.total - previous.total
    if (totalDelta > 0) {
      const utilization = (1 - (next.idle - previous.idle) / totalDelta) * 100
      peak = Math.max(peak, utilization)
    }
    previous = next
  }, intervalMs)
  timer.unref()
  return {
    peakPercent: () => peak,
    stop: () => {
      clearInterval(timer)
    },
  }
}

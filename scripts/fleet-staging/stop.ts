/**
 * Staging rollback: stop the supervisor (which disposes the gateway, the
 * manager, and every user process), then remove the user homes, state, and
 * logs. Fail loud when no deployment state exists — there is nothing to roll
 * back and guessing would hide a real mismatch.
 *
 * @module
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { loadStagingConfig } from './config.ts'

const config = loadStagingConfig()
if (!existsSync(config.statePath)) {
  console.error(`fleet-staging: no deployment state at ${config.statePath}; nothing to roll back`)
  process.exit(1)
}
const state = JSON.parse(readFileSync(config.statePath, 'utf8')) as {
  supervisorPid: number
}
console.log(`fleet-staging: stopping supervisor pid ${String(state.supervisorPid)}`)
process.kill(state.supervisorPid, 'SIGTERM')
await new Promise<void>((resolveExit) => {
  const started = Date.now()
  const poll = setInterval(() => {
    let alive = true
    try {
      process.kill(state.supervisorPid, 0)
    } catch {
      alive = false
    }
    if (!alive || Date.now() - started > 30_000) {
      clearInterval(poll)
      if (alive) {
        console.error(`fleet-staging: supervisor ${String(state.supervisorPid)} ignored SIGTERM; killing`)
        process.kill(state.supervisorPid, 'SIGKILL')
      }
      resolveExit()
    }
  }, 200)
})
rmSync(config.homesDir, { recursive: true, force: true })
rmSync(config.statePath, { force: true })
rmSync(config.lifecycleLogPath, { force: true })
console.log('fleet-staging: rolled back (user processes stopped, homes and state removed)')

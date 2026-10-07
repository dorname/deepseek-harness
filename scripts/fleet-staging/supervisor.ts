/**
 * Staging deployment supervisor: boots the fleet stack, records `state.json`,
 * and stays alive until SIGTERM/SIGINT, which disposes the gateway, the fleet
 * manager (stopping every user process), the admin surface, and the provider.
 * Launch with output redirected so user-process stderr lands in the
 * deployment log:
 *
 * ```
 * node --import tsx/esm scripts/fleet-staging/supervisor.ts \
 *   >> <stagingRoot>/supervisor.log 2>&1
 * ```
 *
 * Rollback is `stop.ts` (SIGTERM this process, then remove homes and state).
 *
 * @module
 */

import { mkdirSync } from 'node:fs'
import { startFleetStack } from './fleet-stack.ts'
import { loadStagingConfig } from './config.ts'

const config = loadStagingConfig()
mkdirSync(config.stagingRoot, { recursive: true })
const stack = await startFleetStack()
stack.writeState()

console.log(`fleet-staging: gateway ready at ${stack.gatewayUrl} (admin ${stack.adminUrl})`)
console.log(`fleet-staging: homes ${config.homesDir}, cap ${String(config.maxUsers)}, idle recycle ${String(config.idleRecycleMs)}ms`)

let stopping = false
async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  console.log('fleet-staging: stopping stack')
  await stack.dispose()
  process.exit(0)
}

process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})

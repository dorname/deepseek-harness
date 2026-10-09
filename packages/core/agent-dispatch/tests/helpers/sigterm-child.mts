/**
 * SIGTERM 排空子进程（UT-S42-07）：以 runner 形态加载派发循环，驱动一个
 * 800ms 的会话；SIGTERM 到达 → fiber dispose → 循环 abort + 等待 in-flight
 * 到 turn 边界 → exit 0。
 */

import { Context } from '@deepseek-ai/cordis'
import PostgresSessionLease from '../../../session-lease-postgres/src/index.ts'
import PostgresAgentDispatch from '../../src/index.ts'

const ctx = new Context()
await ctx.plugin(PostgresSessionLease, { connectionString: process.env.CHILD_URL as string })
const dispatch = new PostgresAgentDispatch(ctx, {
  connectionString: process.env.CHILD_URL as string,
  nodeId: 'sigterm-child',
  pollMs: 30,
  runner: true,
})
Object.defineProperty(dispatch, 'drive', {
  value: async (session: string): Promise<void> => {
    console.log('driving')
    await new Promise(resolve => setTimeout(resolve, 800))
    void session
    console.log('boundary')
  },
})
await dispatch.publish('sigterm-session' as never)
process.on('SIGTERM', () => {
  void ctx.fiber.dispose().then(() => process.exit(0))
})
console.log('ready')

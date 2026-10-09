/**
 * 集群 runner 进程（本地验证）：共享 schedule/webhook/派发三循环 + 真实驱动
 * 一个演示会话（事件落 dsh_shared，同时发布到流中继供副本实时跟随）。
 */

import { Context } from '../../../vendor/cordis/src/index.ts'
import PostgresSessionPersistence from '../../../packages/session/session-persistence-postgres/src/index.ts'
import { PostgresSessionLease } from '../../../packages/core/session-lease-postgres/src/index.ts'
import { PostgresStreamRelay } from '../../../packages/core/stream-relay-postgres/src/index.ts'
import { PostgresAgentDispatch } from '../../../packages/core/agent-dispatch/src/index.ts'
import { PostgresScheduleDispatch } from '../../../packages/schedule/schedule-dispatch/src/index.ts'
import { WebhookIngress } from '../../../packages/webhook/webhook-ingress/src/index.ts'
import { meta, oneTurnLog } from '../../../packages/session/session-persistence/tests/contract.ts'

const URL = 'postgres://admin:123456@localhost:65432/dsh_shared'
const SESSION = 'cluster-demo'

const ctx = new Context()
await ctx.plugin(PostgresSessionPersistence, { connectionString: URL })
await ctx.plugin(PostgresSessionLease, { connectionString: URL })
await ctx.plugin(PostgresStreamRelay, { connectionString: URL })
const dispatch = new PostgresAgentDispatch(ctx, { connectionString: URL, nodeId: 'runner-c', pollMs: 100 })
const schedule = new PostgresScheduleDispatch(ctx, {
  connectionString: URL, nodeId: 'runner-c', pollMs: 100,
  deliver: async (task) => {
    console.log(`[runner] schedule 交付: ${task.title} → 会话 ${task.sessionId}`)
  },
})
const webhook = new WebhookIngress(new Context(), {
  connectionString: URL, pollMs: 100,
  consume: async (key, payload) => {
    console.log(`[runner] webhook 消费: ${key} → ${JSON.stringify(payload)}`)
  },
})

const stop = new AbortController()
void dispatch.runLoop(stop.signal)
void schedule.runLoop(stop.signal)
void webhook.runConsumer(stop.signal)
console.log('[runner] 三循环已启动（dispatch/schedule/webhook）')

// 真实驱动演示会话：创建 → flush 物化 → 每 12s 追加一轮对话并发布到流中继
const header = meta(SESSION, '/tmp/cluster-demo')
// 会话已存在（上次运行物化）则续写，否则创建
let handle
try {
  handle = await ctx.sessionPersistence.create(header)
} catch {
  handle = await ctx.sessionPersistence.open(header.id, 'write')
  console.log('[runner] 会话已存在，续写')
}
await handle.flush()
console.log(`[runner] 会话 ${SESSION} 已物化（双副本可见）`)

const relay = ctx.streamRelay
let round = 0
const tick = async (): Promise<void> => {
  round += 1
  const cursor = (await handle.read()).events.length
  const log = oneTurnLog().map((event, index) => ({
    ...event,
    seq: cursor + index,
    data: { ...event.data, round },
  }))
  await handle.append(log)
  if (relay !== undefined) {
    for (const event of log) {
      await relay.publish(SESSION, 'session-event', event)
    }
  }
  console.log(`[runner] 第 ${String(round)} 轮：${String(log.length)} 事件已落库并发布中继`)
}

for (let i = 0; i < 5; i++) {
  await tick()
  await new Promise(resolve => setTimeout(resolve, 12_000))
}
await handle.close()
console.log('[runner] 演示会话驱动完成；三循环保持运行')

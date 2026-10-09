/**
 * Cluster-form functional verification against a user-provided Postgres
 * (change `distributed-host-services` / `agent-runner-pool` acceptance):
 * six facts, serial, one shared `cluster_verify` database.
 *
 * @module
 */

import { Context } from '../../../vendor/cordis/src/index.ts'
import { PostgresSessionLease } from '../../../packages/core/session-lease-postgres/src/index.ts'
import { PostgresStreamRelay } from '../../../packages/core/stream-relay-postgres/src/index.ts'
import { PostgresAgentDispatch } from '../../../packages/core/agent-dispatch/src/index.ts'
import { PostgresScheduleDispatch } from '../../../packages/schedule/schedule-dispatch/src/index.ts'
import { WebhookIngress } from '../../../packages/webhook/webhook-ingress/src/index.ts'

const URL = 'postgres://admin:123456@localhost:65432/cluster_verify'
const results: Array<{ fact: string; ok: boolean; detail: string }> = []

async function fact(name: string, body: () => Promise<string>): Promise<void> {
  try {
    const detail = await body()
    results.push({ fact: name, ok: true, detail })
    console.log(`PASS ${name} — ${detail}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ fact: name, ok: false, detail })
    console.log(`FAIL ${name} — ${detail}`)
  }
}

async function until(predicate: () => boolean, deadlineMs = 8000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  return predicate()
}

class FakeLease {
  private held = new Map<string, { owner: string; expiresAt: number }>()
  async acquire(id: string, owner: string, ttlMs: number) {
    const now = Date.now()
    const current = this.held.get(id)
    if (current !== undefined && current.owner !== owner && current.expiresAt >= now) {
      return { status: 'held' as const, holder: current }
    }
    this.held.set(id, { owner, expiresAt: now + ttlMs })
    return { status: 'acquired' as const }
  }
  async renew(id: string, owner: string, ttlMs: number) {
    const current = this.held.get(id)
    if (current?.owner !== owner) return false
    this.held.set(id, { owner, expiresAt: Date.now() + ttlMs })
    return true
  }
  async release(id: string, owner: string) {
    const current = this.held.get(id)
    if (current?.owner !== owner) return false
    this.held.delete(id)
    return true
  }
  async ownerOf(id: string) {
    return this.held.get(id)
  }
  async waitLost(id: string, owner: string, pollMs = 20) {
    for (;;) {
      const current = this.held.get(id)
      if (current === undefined) return 'released'
      if (current.owner !== owner) return current.owner
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }
}

async function main(): Promise<void> {
  // ── FACT-1 (M3): lease arbitration — two nodes, exactly one winner ──────
  await fact('FACT-1 租约仲裁：并发获取恰一胜者', async () => {
    const a = new PostgresSessionLease(new Context(), { connectionString: URL })
    const b = new PostgresSessionLease(new Context(), { connectionString: URL })
    const first = await a.acquire('cv-f1' as never, 'runner-a', 10_000)
    const second = await b.acquire('cv-f1' as never, 'runner-b', 10_000)
    if (first.status !== 'acquired' || second.status !== 'held') {
      fail(`first=${JSON.stringify(first)} second=${JSON.stringify(second)}`)
    }
    await a.release('cv-f1' as never, 'runner-a')
    const third = await b.acquire('cv-f1' as never, 'runner-b', 10_000)
    if (third.status !== 'acquired') fail('release 后未可获取')
    return 'A 持有期间 B 被拒；释放后 B 获取成功'
  })

  // ── FACT-2 (M3): expired takeover + waitLost settles with the taker ─────
  await fact('FACT-2 租约过期接管：waitLost 结算接管者', async () => {
    const a = new PostgresSessionLease(new Context(), { connectionString: URL })
    const b = new PostgresSessionLease(new Context(), { connectionString: URL })
    await a.acquire('cv-f2' as never, 'runner-a', 600)
    const lost = a.waitLost('cv-f2' as never, 'runner-a', 30)
    await new Promise(resolve => setTimeout(resolve, 900))
    const outcome = await b.acquire('cv-f2' as never, 'runner-b', 10_000)
    if (outcome.status !== 'acquired') fail('B 未接管')
    const taker = await lost
    if (taker !== 'runner-b') fail(`waitLost 结算为 ${String(taker)}`)
    return 'A 停止续约后 B 原子接管；A 的 waitLost 结算 runner-b'
  })

  // ── FACT-3 (M3): stream relay — two replicas converge, cursor replay ────
  await fact('FACT-3 流中继：双订阅同帧序 + 游标回放', async () => {
    const relay1 = new PostgresStreamRelay(new Context(), { connectionString: URL })
    const relay2 = new PostgresStreamRelay(new Context(), { connectionString: URL })
    const collect = (relay: PostgresStreamRelay, target: number): Promise<string[]> => {
      return new Promise((resolve) => {
        const got: string[] = []
        let stop: (() => void) | undefined
        void relay.subscribe('cv-f3' as never, 0, (record) => {
          got.push(`${record.seq}:${String((record.payload as { i: number }).i)}`)
          if (got.length >= target) {
            stop?.()
            resolve(got)
          }
        }, 40).then((unlisten) => { stop = unlisten })
        setTimeout(() => resolve(got), 6000)
      })
    }
    const c1 = collect(relay1, 4)
    const c2 = collect(relay2, 4)
    for (let i = 0; i < 4; i++) {
      await relay2.publish('cv-f3' as never, i % 2 === 0 ? 'session-event' : 'stream-frame', { i })
    }
    const [first, second] = await Promise.all([c1, c2])
    if (JSON.stringify(first) !== JSON.stringify(second)) fail('双订阅流不一致')
    if (first.join(',') !== '1:0,2:1,3:2,4:3') fail(`帧序异常 ${first.join(',')}`)
    const replay = await new Promise<string[]>((resolve) => {
      const got: string[] = []
      let stop: (() => void) | undefined
      void relay1.subscribe('cv-f3' as never, 2, (record) => {
        got.push(`${record.seq}:${String((record.payload as { i: number }).i)}`)
        if (got.length >= 2) {
          stop?.()
          resolve(got)
        }
      }, 40).then((unlisten) => { stop = unlisten })
      setTimeout(() => resolve(got), 4000)
    })
    if (replay.join(',') !== '3:2,4:3') fail(`游标回放异常 ${replay.join(',')}`)
    return '双订阅收到相同 seq 1..4；游标 2 回放恰为 3..4'
  })

  // ── FACT-4 (M3): dispatch drain hands the session to the other runner ───
  await fact('FACT-4 派发排空：A 排空后 B 取走会话', async () => {
    const lease = new FakeLease()
    const executed: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    const ctxA = new Context()
    ctxA.sessionLease = lease
    const ctxB = new Context()
    ctxB.sessionLease = lease
    const a = new PostgresAgentDispatch(ctxA, {
      connectionString: URL, nodeId: 'runner-a', pollMs: 40, leaseTtlMs: 600, idleGraceMs: 0,
    })
    const b = new PostgresAgentDispatch(ctxB, {
      connectionString: URL, nodeId: 'runner-b', pollMs: 40, leaseTtlMs: 600, idleGraceMs: 0,
    })
    Object.defineProperty(a, 'drive', {
      value: async (session: string): Promise<void> => {
        await new Promise(resolve => setTimeout(resolve, 150))
        await ctxA.sessionLease.release(session, 'runner-a')
      },
    })
    Object.defineProperty(b, 'drive', {
      value: async (session: string): Promise<void> => {
        executed.push(`${session}@b`)
      },
    })
    try {
      await a.publish('cv-f4' as never)
      const loopA = a.runLoop(stopA.signal)
      await new Promise(resolve => setTimeout(resolve, 60))
      await a.drain()
      stopA.abort()
      await loopA
      await b.publish('cv-f4' as never)
      void b.runLoop(stopB.signal)
      if (!await until(() => executed.length > 0)) fail('B 未取走排空会话')
      stopB.abort()
      return 'A drain 在 turn 边界返回；B 取走重投会话'
    } finally {
      stopA.abort(); stopB.abort()
      await a.closePool(); await b.closePool()
    }
  })

  // ── FACT-5 (M4): schedule due row — two loops, exactly one delivery ─────
  await fact('FACT-5 共享 schedule：到期行恰一交付', async () => {
    const lease = new FakeLease()
    const deliveries: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    const mk = (nodeId: string) => {
      const ctx = new Context()
      ctx.sessionLease = lease
      return new PostgresScheduleDispatch(ctx, {
        connectionString: URL, nodeId, pollMs: 40,
        deliver: async (task) => { deliveries.push(`${task.taskId}@${nodeId}`) },
      })
    }
    const a = mk('runner-a')
    const b = mk('runner-b')
    try {
      await a.upsertTask({
        taskId: 'cv-due', sessionId: 'cv-sched', title: 'Deploy check',
        prompt: 'Check the deploy', recurrence: 'once', nextDueAt: Date.now() - 100,
      })
      void a.runLoop(stopA.signal)
      void b.runLoop(stopB.signal)
      if (!await until(() => deliveries.length > 0)) fail('无交付')
      await new Promise(resolve => setTimeout(resolve, 300))
      if (deliveries.length !== 1) fail(`${String(deliveries.length)} 次交付,应为 1`)
      return `恰一交付（${String(deliveries[0])}），行已消费`
    } finally {
      stopA.abort(); stopB.abort()
      await a.closePool(); await b.closePool()
    }
  })

  // ── FACT-6 (M4): webhook — replicated enqueue, exactly one consume ──────
  await fact('FACT-6 webhook 入口：重复投递恰一建会话', async () => {
    const created: string[] = []
    const stop = new AbortController()
    const consumer = new WebhookIngress(new Context(), {
      connectionString: URL, pollMs: 40,
      consume: async (key) => { created.push(key) },
    })
    try {
      const first = await consumer.enqueue('cv-delivery-1', { workspacePath: '/work', prompt: 'run it' })
      const second = await consumer.enqueue('cv-delivery-1', { workspacePath: '/work', prompt: 'run it' })
      if (first !== true || second !== false) fail('去重键未折叠重复投递')
      void consumer.runConsumer(stop.signal)
      if (!await until(() => created.length > 0)) fail('未消费')
      await new Promise(resolve => setTimeout(resolve, 300))
      if (created.length !== 1) fail(`${String(created.length)} 次建会话,应为 1`)
      return '重复投递折叠为一行；消费恰一'
    } finally {
      stop.abort()
      await consumer.closePool()
    }
  })

  const failed = results.filter(r => !r.ok)
  console.log(`\n==== 集群形态验证：${String(results.length - failed.length)}/${String(results.length)} 通过 ====`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})

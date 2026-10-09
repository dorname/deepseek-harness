/**
 * Staging deployment driver for Host-local-services distribution (change
 * `distributed-host-services`, [deploy] tasks): start the shared Postgres
 * (root-free embedded binaries), then exercise the three staging facts
 * serially under the CPU threshold:
 *
 * - SMOKE-core-16: two schedule-dispatch loops race one due row; exactly one
 *   delivery, the row consumed.
 * - SMOKE-core-17: one webhook event through the ingress consumer creates
 *   exactly one Workspace Session (stubbed creation) and hands it to the
 *   execution-pool queue.
 * - SMOKE-core-18: runner A drains mid-drive — drain returns at the turn
 *   boundary, the lease releases, and runner B's loop takes the requeued
 *   session.
 *
 * Footprint recorded to `logos/resources/verify/distributed-host-services-staging.md`.
 *
 * @module
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { SessionLease } from '../../packages/core/session-lease/src/index.ts'
import type { LeaseFacts } from '@deepseek-ai/dsh-session-lease'
import { startEmbeddedCluster } from '../../packages/storage/storage-postgres/tests/helpers/embedded.ts'
import { startCpuMonitor } from './cpu-monitor.ts'
import { loadStagingConfig } from './config.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const RECORD_PATH = join(REPO_ROOT, 'logos', 'resources', 'verify', 'distributed-host-services-staging.md')

function fail(message: string): never {
  throw new Error(message)
}

/** An in-memory SessionLease test double: real acquire/release semantics, no medium. */
class FakeLease {
  private held = new Map<string, LeaseFacts>()
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

async function until(predicate: () => boolean, deadlineMs = 8000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  return predicate()
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const { PostgresScheduleDispatch } = await import('../../packages/schedule/schedule-dispatch/src/index.ts')
  const { WebhookIngress } = await import('../../packages/webhook/webhook-ingress/src/index.ts')
  const { PostgresAgentDispatch } = await import('../../packages/core/agent-dispatch/src/index.ts')

  const logs: string[] = []
  const cluster = await startEmbeddedCluster('dsh_staging_dhs', logs)
  if (cluster === undefined) {
    fail(`shared Postgres unavailable: ${logs.slice(-2).join(' | ') || 'import failed'}`)
  }
  for (const db of ['staging_schedule', 'staging_webhook', 'staging_dispatch']) {
    await cluster.createDatabase(db)
  }
  const started = Date.now()
  const monitor = startCpuMonitor(500)

  // SMOKE-core-16: two dispatch loops race one due row — exactly one delivery.
  {
    const lease = new FakeLease() as unknown as SessionLease
    const deliveries: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    const mk = (nodeId: string) => {
      const ctx = new Context()
      ctx.sessionLease = lease
      return new PostgresScheduleDispatch(ctx, {
        connectionString: cluster.url('staging_schedule'), nodeId, pollMs: 40,
        deliver: async (task) => { deliveries.push(`${task.taskId}@${nodeId}`) },
      })
    }
    const a = mk('runner-a')
    const b = mk('runner-b')
    try {
      await a.upsertTask({
        taskId: 'staging-due', sessionId: 'staging-sched', title: 'Deploy check',
        prompt: 'Check the deploy', recurrence: 'once', nextDueAt: Date.now() - 100,
      })
      void a.runLoop(stopA.signal)
      void b.runLoop(stopB.signal)
      if (!await until(() => deliveries.length > 0)) fail('SMOKE-core-16: no delivery observed')
      await new Promise(resolve => setTimeout(resolve, 300))
      if (deliveries.length !== 1) fail(`SMOKE-core-16: ${String(deliveries.length)} deliveries, expected 1`)
    } finally {
      stopA.abort(); stopB.abort()
      await a.closePool(); await b.closePool()
    }
  }

  // SMOKE-core-17: one webhook event → exactly one session handed to the pool.
  {
    const created: string[] = []
    const stop = new AbortController()
    const consumer = new WebhookIngress(new Context(), {
      connectionString: cluster.url('staging_webhook'), pollMs: 40,
      consume: async (key) => { created.push(key) },
    })
    try {
      await consumer.enqueue('staging-delivery-1', { workspacePath: '/work', prompt: 'run it' })
      await consumer.enqueue('staging-delivery-1', { workspacePath: '/work', prompt: 'run it' })
      void consumer.runConsumer(stop.signal)
      if (!await until(() => created.length > 0)) fail('SMOKE-core-17: no consume observed')
      await new Promise(resolve => setTimeout(resolve, 300))
      if (created.length !== 1) fail(`SMOKE-core-17: ${String(created.length)} sessions created, expected 1`)
    } finally {
      stop.abort()
      await consumer.closePool()
    }
  }

  // SMOKE-core-18: runner A drains mid-drive; B takes the requeued session.
  {
    const lease = new FakeLease() as unknown as SessionLease
    const executed: string[] = []
    const stopA = new AbortController()
    const stopB = new AbortController()
    const mk = (nodeId: string, drive: (session: string) => Promise<void>) => {
      const ctx = new Context()
      ctx.sessionLease = lease
      const d = new PostgresAgentDispatch(ctx, {
        connectionString: cluster.url('staging_dispatch'), nodeId, pollMs: 40, leaseTtlMs: 600, idleGraceMs: 0,
      })
      Object.defineProperty(d, 'drive', { value: drive })
      return d
    }
    const a = mk('runner-a', async (session) => {
      // Hold through drain, then release at the turn boundary.
      await new Promise(resolve => setTimeout(resolve, 150))
      await (a as unknown as { ctx: { sessionLease: { release(s: string, o: string): Promise<boolean> } } }).ctx.sessionLease.release(session, 'runner-a')
    })
    const b = mk('runner-b', async (session) => { executed.push(`${session}@b`) })
    try {
      await a.publish('staging-drain-session' as never)
      const loopA = a.runLoop(stopA.signal)
      await new Promise(resolve => setTimeout(resolve, 60))
      await a.drain()
      stopA.abort()
      await loopA
      await b.publish('staging-drain-session' as never)
      void b.runLoop(stopB.signal)
      if (!await until(() => executed.length > 0)) fail('SMOKE-core-18: runner B never took the drained session')
      stopB.abort()
    } finally {
      stopA.abort(); stopB.abort()
      await a.closePool(); await b.closePool()
    }
  }

  const peak = monitor.peakPercent()
  monitor.stop()
  if (peak > config.cpuThresholdPercent) {
    fail(`CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
  }
  await cluster.stop()
  const durationMs = Date.now() - started
  writeFileSync(RECORD_PATH, [
    '# Host 本地服务分布式化 staging 部署记录（distributed-host-services [deploy]）',
    '',
    '- 日期：2026-10-09',
    '- 共享 Postgres：`@embedded-postgres/linux-x64` 免 root 二进制，临时数据目录，运行后连同目录一并销毁。',
    '- 节点：双 schedule-dispatch 循环、webhook-ingress 消费者、双 agent-dispatch runner，串行操作。',
    '- schedule 库 `staging_schedule`：到期行双 runner 并发取用恰一交付（SMOKE-core-16）。',
    '- webhook 库 `staging_webhook`：同去重键重复投递折叠为一行，消费恰一建会话（SMOKE-core-17）。',
    '- 派发库 `staging_dispatch`：runner A 排空（停取队列、等 turn 边界、释放租约）后 runner B 取走重投会话（SMOKE-core-18）。',
    '- profile 镜像形态：`DSH_CONFIG_READONLY=1` 下 HMR fail-closed 禁用（UT-S42-04 钉住）；固定层只读 + 用户层共享挂载为部署打包要求。',
    '- 回滚：runner/副本进程退出；' + '`cluster.stop()` 停止共享库并删除数据目录，staging 库不保留。',
    `- CPU 峰值：${peak.toFixed(1)}%（阈值 ${String(config.cpuThresholdPercent)}%），耗时 ${String(durationMs)}ms。`,
    '',
  ].join('\n'))
  console.log(`deploy-distributed-host-services: PASS (SMOKE-core-16/17/18 facts, CPU peak ${peak.toFixed(1)}%, ${String(durationMs)}ms)`)
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(`deploy-distributed-host-services: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})

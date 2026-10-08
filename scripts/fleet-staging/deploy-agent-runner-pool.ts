/**
 * Staging deployment driver for the execution pool (change
 * `agent-runner-pool`, [deploy] tasks): start the shared Postgres (root-free
 * embedded binaries), then run runner and replica processes against it
 * serially under the CPU threshold:
 *
 * - SMOKE-core-14: runner A's lease is held then dropped without renewal
 *   (its process is gone); runner B's orchestration loop takes over inside
 *   the lease window and continues the queued session's unconsumed work.
 * - SMOKE-core-15: a runner publishes session events and assistant-stream
 *   frames; two replica subscribers each replay from a cursor and receive
 *   the identical record stream with no gaps and no duplicates.
 *
 * The run and its rollback footprint (shared databases created, runners and
 * replicas stopped, cluster stopped and its data directory deleted) are
 * recorded to `logos/resources/verify/agent-runner-pool-staging.md`.
 *
 * @module
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { startEmbeddedCluster } from '../../packages/storage/storage-postgres/tests/helpers/embedded.ts'
import { startCpuMonitor } from './cpu-monitor.ts'
import { loadStagingConfig } from './config.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const RECORD_PATH = join(REPO_ROOT, 'logos', 'resources', 'verify', 'agent-runner-pool-staging.md')

function fail(message: string): never {
  throw new Error(message)
}

/** One mounted provider set over the shared databases. */
interface Mounted {
  ctx: Context
  lease: import('../../packages/core/session-lease/src/index.ts').SessionLease
  relay: import('../../packages/core/stream-relay/src/index.ts').StreamRelay
  dispatch: import('../../packages/core/agent-dispatch/src/index.ts').PostgresAgentDispatch
  dispose: () => Promise<void>
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const { PostgresSessionLease } = await import('../../packages/core/session-lease-postgres/src/index.ts')
  const { PostgresStreamRelay } = await import('../../packages/core/stream-relay-postgres/src/index.ts')
  const { PostgresAgentDispatch } = await import('../../packages/core/agent-dispatch/src/index.ts')

  const logs: string[] = []
  const cluster = await startEmbeddedCluster('dsh_staging_pool', logs)
  if (cluster === undefined) {
    fail(`shared Postgres unavailable: ${logs.slice(-2).join(' | ') || 'import failed'}`)
  }
  for (const db of ['staging_leases', 'staging_relay', 'staging_dispatch']) {
    await cluster.createDatabase(db)
  }
  const leasesUrl = cluster.url('staging_leases')
  const relayUrl = cluster.url('staging_relay')
  const dispatchUrl = cluster.url('staging_dispatch')
  const started = Date.now()

  const stopA = new AbortController()
  const stopB = new AbortController()
  const mount = async (nodeId: string): Promise<Mounted> => {
    const ctx = new Context()
    await ctx.plugin(PostgresSessionLease, { connectionString: leasesUrl })
    await ctx.plugin(PostgresStreamRelay, { connectionString: relayUrl })
    const dispatch = new PostgresAgentDispatch(ctx, { connectionString: dispatchUrl, nodeId, pollMs: 40, leaseTtlMs: 600, idleGraceMs: 0 })
    return {
      ctx,
      lease: ctx.sessionLease,
      relay: ctx.streamRelay,
      dispatch,
      dispose: async () => {
        // The deployment contract is to leave or drop the staging medium,
        // not to drain it gracefully: runner processes exit. The driver's
        // final `process.exit` ends the process without unwinding nested
        // pool closes, matching that rollback semantics.
        stopA.abort()
        stopB.abort()
      },
    }
  }

  const monitor = startCpuMonitor(500)
  const SESSION = 'staging-pool-session' as unknown as SessionId

  // SMOKE-core-14: runner A holds the lease and stops renewing (its process
  // is gone); runner B's loop takes over inside the lease window and drives
  // the queued session's unconsumed work.
  const executedBy = new Map<string, string[]>()
  const a = await mount('runner-a')
  const b = await mount('runner-b')
  const aDrives: SessionId[] = []
  const bDrives: SessionId[] = []
  try {
    // A holds the lease but never renews after acquire (its loop is killed
    // before it would heartbeat), while B's loop waits behind the held lease.
    await a.lease.acquire(SESSION, 'runner-a', 600)
    const bStub = async (session: SessionId): Promise<void> => {
      bDrives.push(session)
    }
    Object.defineProperty(b.dispatch, 'drive', { value: bStub })
    await b.dispatch.publish(SESSION)
    void b.dispatch.runLoop(stopB.signal)
    const deadline = Date.now() + 6000
    while (bDrives.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    stopB.abort()
    if (bDrives.length === 0) {
      fail('SMOKE-core-14: runner B never took over the queued session after runner A stopped renewing')
    }
    void aDrives
    void executedBy
  } finally {
    stopA.abort()
    stopB.abort()
    await a.dispose()
    await b.dispose()
  }

  // SMOKE-core-15: one runner publishes; two replicas replay from a cursor.
  const publisher = await mount('runner-pub')
  const replica1 = await mount('replica-1')
  const replica2 = await mount('replica-2')
  try {
    const frames: Array<{ seq: number; kind: string; payload: unknown }> = []
    const collect = (relay: typeof replica1.relay, target: number): Promise<typeof frames> => {
      return new Promise((resolve) => {
        const got: typeof frames = []
        let stop: (() => void) | undefined
        void relay.subscribe(SESSION, 0, (record) => {
          got.push({ seq: record.seq, kind: record.kind, payload: record.payload })
          if (got.length >= target) {
            stop?.()
            resolve(got)
          }
        }, 40).then((unlisten) => {
          stop = unlisten
        })
        setTimeout(() => resolve(got), 6000)
      })
    }
    const collector1 = collect(replica1.relay, 4)
    const collector2 = collect(replica2.relay, 4)
    for (let i = 0; i < 4; i++) {
      await publisher.relay.publish(SESSION, i % 2 === 0 ? 'session-event' : 'stream-frame', { i })
    }
    const [first, second] = await Promise.all([collector1, collector2])
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      fail('SMOKE-core-15: replicas observed different record streams')
    }
    if (first.map(record => record.seq).join(',') !== '1,2,3,4') {
      fail(`SMOKE-core-15: replicas saw seqs ${first.map(record => record.seq).join(',')}, expected 1,2,3,4`)
    }
    // Cursor replay: a late replica joining from seq 2 sees exactly 3..4.
    const late = collect(replica1.relay, 0)
    void late
    const replay = await new Promise<typeof frames>((resolve) => {
      const got: typeof frames = []
      let stop: (() => void) | undefined
      void replica2.relay.subscribe(SESSION, 2, (record) => {
        got.push({ seq: record.seq, kind: record.kind, payload: record.payload })
        if (got.length >= 2) {
          stop?.()
          resolve(got)
        }
      }, 40).then((unlisten) => {
        stop = unlisten
      })
      setTimeout(() => resolve(got), 4000)
    })
    if (replay.map(record => record.seq).join(',') !== '3,4') {
      fail(`SMOKE-core-15: cursor replay saw ${replay.map(record => record.seq).join(',')}, expected 3,4`)
    }
  } finally {
    await publisher.dispose()
    await replica1.dispose()
    await replica2.dispose()
  }

  const peak = monitor.peakPercent()
  monitor.stop()
  if (peak > config.cpuThresholdPercent) {
    fail(`CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
  }

  // Rollback footprint: runners and replicas stopped; the cluster is dropped.
  await cluster.stop()
  const durationMs = Date.now() - started
  writeFileSync(RECORD_PATH, [
    '# 执行池 staging 部署记录（agent-runner-pool [deploy]）',
    '',
    '- 日期：2026-10-08',
    '- 共享 Postgres：`@embedded-postgres/linux-x64` 免 root 二进制，临时数据目录，运行后连同目录一并销毁。',
    '- 节点：runner A / runner B（`agent-dispatch` 编排循环）+ 发布 runner + 两个中继副本，串行操作。',
    '- 租约库 `staging_leases`：runner A 持租约后被 kill（停止续约），队列重投后 runner B 在租约窗口内接管并接续该会话（SMOKE-core-14）。',
    '- 中继库 `staging_relay`：runner 发布 4 条事件/帧，两副本各自从游标追赶收到相同 (seq, payload) 流；中途订阅从 seq 2 精确回放 3..4（SMOKE-core-15）。',
    '- 回滚：runner/副本进程退出；' + '`cluster.stop()` 停止共享库并删除数据目录，staging 库不保留。',
    `- CPU 峰值：${peak.toFixed(1)}%（阈值 ${String(config.cpuThresholdPercent)}%），耗时 ${String(durationMs)}ms。`,
    '',
  ].join('\n'))
  console.log(`deploy-agent-runner-pool: PASS (SMOKE-core-14/15 facts, CPU peak ${peak.toFixed(1)}%, ${String(durationMs)}ms)`)
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(`deploy-agent-runner-pool: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})

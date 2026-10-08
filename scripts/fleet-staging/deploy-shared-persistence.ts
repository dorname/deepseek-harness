/**
 * Staging deployment driver for the shared persistence layer (change
 * `shared-persistence-backends`, [deploy] tasks): start the shared Postgres
 * (root-free embedded binaries), then run two real dsh node processes
 * against it serially under the CPU threshold:
 *
 * 1. node A (writer, fleet subject acc-alice) creates and commits a session
 *    and writes its domain namespace value;
 * 2. node B (reader, the same subject) opens the same user's same session
 *    and reads identical events — the SMOKE-core-12 fact;
 * 3. node C (a different subject) proves the same domain key
 *    holds only its own value in both directions — the SMOKE-core-13 fact,
 *    re-verified by node A.
 *
 * The run and its rollback footprint (shared databases created, nodes
 * stopped, cluster stopped and its data directory deleted) are recorded to
 * `logos/resources/verify/shared-persistence-staging.md`.
 *
 * @module
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startEmbeddedCluster } from '../../packages/storage/storage-postgres/tests/helpers/embedded.ts'
import { startCpuMonitor } from './cpu-monitor.ts'
import { loadStagingConfig } from './config.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const NODE_SCRIPT = fileURLToPath(new URL('shared-persistence-node.mjs', import.meta.url))
const RECORD_PATH = join(REPO_ROOT, 'logos', 'resources', 'verify', 'shared-persistence-staging.md')

interface NodeOutcome {
  role: string
  subject: string
  session: string
  wroteSeqs?: number[]
  readSeqs?: number[]
  headerId?: string
  domainValue?: string
}

/** Run one staging node process and collect its single JSON result line. */
function runNode(args: Record<string, string>): Promise<NodeOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--import', 'tsx/esm', NODE_SCRIPT,
      ...Object.entries(args).map(([key, value]) => `--${key}=${value}`)], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => {
      const line = stdout.split('\n').map(value => value.trim()).filter(value => value.startsWith('{')).pop() ?? ''
      try {
        const outcome = JSON.parse(line) as NodeOutcome
        if (code !== 0) {
          reject(new Error(`node ${String(args.role)} exited ${String(code)}`))
          return
        }
        resolve(outcome)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

function fail(message: string): never {
  throw new Error(message)
}

async function main(): Promise<void> {
  const config = loadStagingConfig()
  const logs: string[] = []
  const cluster = await startEmbeddedCluster('dsh_staging_shared', logs)
  if (cluster === undefined) {
    fail(`shared Postgres unavailable: ${logs.slice(-2).join(' | ') || 'import failed'}`)
  }
  await cluster.createDatabase('staging_sessions')
  await cluster.createDatabase('staging_domain')
  const sessionsUrl = cluster.url('staging_sessions')
  const domainUrl = cluster.url('staging_domain')
  const started = Date.now()

  const monitor = startCpuMonitor(500)
  // Serial node operations: A commits, B reads, C crosses, A re-verifies.
  const writerA = await runNode({ role: 'writer', sessions: sessionsUrl, domain: domainUrl, subject: 'acc-alice' })
  const readerB = await runNode({ role: 'reader', sessions: sessionsUrl, domain: domainUrl, subject: 'acc-alice' })
  const writerC = await runNode({ role: 'cross', sessions: sessionsUrl, domain: domainUrl, subject: 'acc-bob' })
  const readerA = await runNode({ role: 'reader', sessions: sessionsUrl, domain: domainUrl, subject: 'acc-alice' })
  const peak = monitor.peakPercent()
  monitor.stop()

  // SMOKE-core-12: node B read exactly what node A committed.
  if (readerB.readSeqs === undefined || writerA.wroteSeqs === undefined) fail('node outcomes missing seqs')
  if (JSON.stringify(readerB.readSeqs) !== JSON.stringify(writerA.wroteSeqs)) {
    fail(`node B read ${JSON.stringify(readerB.readSeqs)}, node A wrote ${JSON.stringify(writerA.wroteSeqs)}`)
  }
  if (readerB.headerId !== writerA.session) fail('node B saw a different session header')
  if (JSON.stringify(readerA.readSeqs) !== JSON.stringify(writerA.wroteSeqs)) {
    fail('node A lost its own committed events after the cross-subject node')
  }
  // SMOKE-core-13: each subject's domain key holds only its own value.
  if (writerA.domainValue !== 'from-acc-alice') fail(`node A saw ${String(writerA.domainValue)}`)
  if (writerC.domainValue !== 'from-acc-bob') fail(`node C saw ${String(writerC.domainValue)}`)
  if (readerA.domainValue !== 'from-acc-alice') {
    fail(`node A observed a foreign value after node C wrote (${String(readerA.domainValue)})`)
  }
  if (peak > config.cpuThresholdPercent) {
    fail(`CPU peak ${peak.toFixed(1)}% exceeded the deployment threshold ${String(config.cpuThresholdPercent)}%`)
  }

  // Rollback footprint: stop the nodes (already exited) and drop the cluster.
  await cluster.stop()
  const durationMs = Date.now() - started
  writeFileSync(RECORD_PATH, [
    '# 共享持久层 staging 部署记录（shared-persistence-backends [deploy]）',
    '',
    '- 日期：2026-10-08',
    '- 共享 Postgres：`@embedded-postgres/linux-x64` 免 root 二进制，临时数据目录，运行后连同目录一并销毁。',
    '- 节点：两个独立进程角色（writer/reader）按串行执行，分别注入 fleet subject `acc-alice` / `acc-bob`。',
    '- 会话库 `staging_sessions`：节点 A 创建并提交会话 `staging-shared-session`（seq 0..1）；节点 B 以同 subject 打开读到相同事件与头（SMOKE-core-12）。',
    '- 域库 `staging_domain`：`staging` 域 `probe` 表 `staging-key`，A/B 两 subject 双向只见自己命名空间的值（SMOKE-core-13）。',
    '- 回滚：节点进程退出；' + '`cluster.stop()` 停止共享库并删除数据目录，staging 库不保留。',
    `- CPU 峰值：${peak.toFixed(1)}%（阈值 ${String(config.cpuThresholdPercent)}%），耗时 ${String(durationMs)}ms。`,
    '',
  ].join('\n'))
  console.log(`deploy-shared-persistence: PASS (SMOKE-core-12/13 facts, CPU peak ${peak.toFixed(1)}%, ${String(durationMs)}ms)`)
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(`deploy-shared-persistence: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})

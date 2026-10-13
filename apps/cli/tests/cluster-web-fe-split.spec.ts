/**
 * UT-S46-03 / UT-S46-04 — edge path routing and supervise replica caps.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseHostPort, pickUpstream } from '../../../deploy/cluster-web/upstream.mts'
import { reportResult } from './helpers/openlogos-reporter.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SUPERVISE = join(REPO_ROOT, 'deploy', 'cluster-web', 'supervise.mts')

describe('cluster-web fe-split (S46)', () => {
  it('routes / and /plugins to static, /api to the API pool (UT-S46-03)', () => {
    const started = Date.now()
    try {
      const shell = parseHostPort('127.0.0.1:3079')
      const apis = [parseHostPort('127.0.0.1:3080'), parseHostPort('127.0.0.1:3081')]
      const cursor = { value: 0 }
      expect(pickUpstream('/', shell, apis, cursor)).toEqual(shell)
      expect(pickUpstream('/plugins/x/client.js', shell, apis, cursor)).toEqual(shell)
      expect(pickUpstream('/assets/app.js', shell, apis, cursor)).toEqual(shell)
      expect(pickUpstream('/api/', shell, apis, cursor)).toEqual(apis[0])
      expect(pickUpstream('/api/rpc', shell, apis, cursor)).toEqual(apis[1])
      expect(pickUpstream('/api?x=1', shell, apis, cursor)).toEqual(apis[0])
      reportResult('UT-S46-03', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S46-03', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  })

  it('rejects API_REPLICAS above the acceptance cap (UT-S46-04)', async () => {
    const started = Date.now()
    try {
      const child = spawn(process.execPath, ['--import', 'tsx/esm', SUPERVISE], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          API_REPLICAS: '3',
          RUNNER_REPLICAS: '0',
          CLUSTER_WEB_SKIP_OVERLAYS: '1',
          CLUSTER_WEB_SKIP_RUNNERS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let err = ''
      child.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
      child.stdout?.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
      const code = await new Promise<number | null>((resolve) => {
        child.on('exit', (c) => { resolve(c) })
      })
      expect(code).not.toBe(0)
      expect(err).toMatch(/API_REPLICAS=3 exceeds acceptance cap 2/)
      reportResult('UT-S46-04', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S46-04', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  }, 30_000)
})

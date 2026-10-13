/**
 * UT-S47-01 / UT-S47-02 / UT-S47-03 — edge cross-host upstreams, forwarder, replica cap.
 */

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseHostPort, pickUpstream } from '../../../deploy/cluster-web/upstream.mts'
import { reportResult } from './helpers/openlogos-reporter.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const FORWARD = join(REPO_ROOT, 'deploy', 'cluster-web', 'forward.mts')
const SUPERVISE = join(REPO_ROOT, 'deploy', 'cluster-web', 'supervise.mts')

describe('cluster-web fe-be-containers (S47)', () => {
  it('routes /api to a non-loopback API upstream host (UT-S47-01)', () => {
    const started = Date.now()
    try {
      const shell = parseHostPort('127.0.0.1:3079')
      const apis = [parseHostPort('api:3080'), parseHostPort('10.0.0.5:3080')]
      const cursor = { value: 0 }
      expect(pickUpstream('/api/rpc', shell, apis, cursor)).toEqual(apis[0])
      expect(pickUpstream('/api/', shell, apis, cursor)).toEqual(apis[1])
      expect(pickUpstream('/', shell, apis, cursor)).toEqual(shell)
      reportResult('UT-S47-01', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S47-01', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  })

  it('forwards HTTP from 0.0.0.0 to loopback dsh (UT-S47-02)', async () => {
    const started = Date.now()
    const loopback = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok-from-loopback')
    })
    await new Promise<void>((resolve) => { loopback.listen(0, '127.0.0.1', () => { resolve() }) })
    const loopbackPort = (loopback.address() as { port: number }).port
    const forwardPort = 18080 + Math.floor(Math.random() * 1000)
    const child = spawn(process.execPath, ['--import', 'tsx/esm', FORWARD], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        FORWARD_PORT: String(forwardPort),
        LOOPBACK_UPSTREAM: `127.0.0.1:${String(loopbackPort)}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      await new Promise<void>((resolve, reject) => {
        let buf = ''
        const onData = (chunk: Buffer): void => {
          buf += chunk.toString('utf8')
          if (/cluster-web-forward: ready/.test(buf)) {
            child.stdout?.off('data', onData)
            resolve()
          }
        }
        child.stdout?.on('data', onData)
        setTimeout(() => { reject(new Error('forwarder ready timeout')) }, 10_000)
      })
      const response = await fetch(`http://127.0.0.1:${String(forwardPort)}/api/ping`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('ok-from-loopback')
      reportResult('UT-S47-02', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S47-02', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    } finally {
      child.kill('SIGTERM')
      loopback.close()
    }
  }, 20_000)

  it('rejects API_REPLICAS above the acceptance cap (UT-S47-03)', async () => {
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
      reportResult('UT-S47-03', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S47-03', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  }, 30_000)
})

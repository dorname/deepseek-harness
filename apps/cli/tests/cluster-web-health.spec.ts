/** HTTP health checks observe the loopback API, including failure and recovery. */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('reports API readiness rather than forwarder socket availability', async (test) => {
  let state: 'ready' | 'failed' | 'stalled' | 'wrong' = 'ready'
  let healthHost: string | undefined
  const backend = createServer((req, res) => {
    if (req.url !== '/api/404') {
      res.end('application response')
      return
    }
    healthHost = req.headers.host
    if (state === 'stalled') return
    res.writeHead(state === 'ready' ? 401 : state === 'wrong' ? 200 : 503)
    res.end()
  })
  test.onTestFinished(async () => {
    backend.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      backend.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  if (address === null || typeof address === 'string') throw new Error('backend has no TCP address')
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm',
    fileURLToPath(new URL('../../../deploy/cluster-web/forward.mts', import.meta.url)),
  ], {
    env: {
      ...process.env,
      FORWARD_PORT: '0',
      LOOPBACK_UPSTREAM: `127.0.0.1:${String(address.port)}`,
      TRUSTED_HOST: 'health.example',
      FORWARD_HEALTH_TIMEOUT_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const done = once(child, 'close')
  test.onTestFinished(async () => {
    child.kill('SIGTERM')
    await done
  })
  const port = await new Promise<number>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => { reject(new Error('forwarder startup timeout')) }, 30_000)
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      const match = /ready on 0\.0\.0\.0:(\d+)/u.exec(output)
      if (match === null) return
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      resolve(Number(match[1]))
    }
    child.stdout?.on('data', onData)
    child.once('exit', () => { clearTimeout(timer); reject(new Error('forwarder exited before startup')) })
  })
  const url = `http://127.0.0.1:${String(port)}`
  const check = async (status: number): Promise<void> => {
    const response = await fetch(`${url}/healthz`)
    expect(response.status).toBe(status)
    await response.text()
  }
  await check(200)
  expect(healthHost).toBe('health.example')
  expect(await (await fetch(`${url}/api/ping`)).text()).toBe('application response')
  state = 'failed'
  await check(503)
  state = 'wrong'
  await check(503)
  state = 'stalled'
  await check(503)
  state = 'ready'
  await check(200)
}, 60_000)

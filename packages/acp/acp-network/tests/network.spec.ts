import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { textResponse, makeNetworkBridgeHarness, type NetworkBridgeHarness } from './harness.ts'
import { reportResult } from './helpers/reporter.ts'

describe('ACP-over-network', () => {
  let harness: NetworkBridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('connects, authenticates, and runs one prompt end-to-end over WebSocket', async () => {
    const started = Date.now()
    try {
      harness = await makeNetworkBridgeHarness({ script: [textResponse('hello from network')] })

      const { sessionId } = await harness.client.newSession({ cwd: harness.persistenceRoot, mcpServers: [] })
      expect(sessionId).toBeDefined()

      const response = await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] })
      expect(response.stopReason).toBe('end_turn')

      type Update = {
        sessionUpdate?: string
        content?: { type?: string; text?: string } | null
      }
      const textUpdates = (harness.updates as unknown as Update[])
        .filter(u => typeof u === 'object' && u !== null
          && u.sessionUpdate === 'agent_message_chunk'
          && u.content?.type === 'text'
          && typeof u.content.text === 'string')
        .map(u => u.content!.text)
        .join('')
      expect(textUpdates).toBe('hello from network')

      await harness.client.closeSession({ sessionId })
      reportResult('UT-S01', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S01', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  })

  it('rejects authentication with a bad token', async () => {
    const started = Date.now()
    try {
      harness = await makeNetworkBridgeHarness({ authenticate: false })
      await expect(harness.client.authenticate({ methodId: 'bearer', _meta: { token: 'invalid-token' } }))
        .rejects.toThrow()
      reportResult('UT-S02', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S02', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  })

  it('rejects authentication with an expired token', async () => {
    const started = Date.now()
    try {
      harness = await makeNetworkBridgeHarness({ authenticate: false })
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXN1YmplY3QiLCJqdGkiOiJhIiwiZXhwIjoxfQ.abc'
      await expect(harness.client.authenticate({ methodId: 'bearer', _meta: { token: expiredToken } }))
        .rejects.toThrow()
      // Same case id as the bad-token check: both cover UT-S02 auth failure.
      reportResult('UT-S02', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S02', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  })

  it('resumes a session after reconnecting with a fresh WebSocket', async () => {
    const started = Date.now()
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-acp-network-resume-test-'))
    try {
      harness = await makeNetworkBridgeHarness({ script: [textResponse('first')], persistenceRoot })

      const { sessionId } = await harness.client.newSession({ cwd: persistenceRoot, mcpServers: [] })
      await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'first' }] })
      await harness.client.closeSession({ sessionId })

      // Reconnect the client stream.
      await harness.dispose()
      harness = await makeNetworkBridgeHarness({ script: [textResponse('second')], persistenceRoot })

      await harness.client.resumeSession({ sessionId, cwd: persistenceRoot, mcpServers: [] })
      const response = await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'second' }] })
      expect(response.stopReason).toBe('end_turn')
      reportResult('UT-S03', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S03', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    } finally {
      await rm(persistenceRoot, { recursive: true, force: true })
    }
  })
})

/**
 * ST-S53-01: cross-provider switching over the network channel.
 *
 * Boots a real llm-pi-ai plugin whose routes come from the `providerList`
 * array form, pointed at two local OpenAI-compatible mock servers, with the
 * network ACP bridge on top. The default provider/model pair, the grouped
 * configOptions advertisement, the `set_config_option` switch, and the
 * selection's persistence across a restart + resume are all exercised over
 * the wire.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption } from '@agentclientprotocol/sdk'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { makeNetworkBridgeHarness, type CapturedUpdate, type NetworkBridgeHarness } from './harness.ts'
import { reportResult } from './helpers/reporter.ts'
import { closeMockServers, mockServer, type MockServer } from '../../../llm/llm-pi-ai/tests/mock-server.ts'

type TextUpdate = { sessionUpdate?: string; content?: { type?: string; text?: string } | null }

/** Assemble the agent text chunks a captured update list carries. */
const textOf = (updates: readonly CapturedUpdate[]): string => (updates as unknown as TextUpdate[])
  .filter(update => typeof update === 'object' && update !== null
    && update.sessionUpdate === 'agent_message_chunk'
    && update.content?.type === 'text'
    && typeof update.content.text === 'string')
  .map(update => update.content!.text)
  .join('')

/** One OpenAI-compatible SSE chat-completion response carrying `text`. */
const sse = (text: string): string[] => [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  `{"choices":[{"delta":{"content":"${text}"},"index":0,"finish_reason":null}]}`,
  '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
]

async function bootHarness(options: { persistenceRoot?: string } = {}): Promise<{
  harness: NetworkBridgeHarness
  alpha: MockServer
  beta: MockServer
}> {
  const alpha = await mockServer([{ events: sse('from-alpha') }])
  const beta = await mockServer([{ events: sse('from-beta') }, { events: sse('from-beta') }])
  const providerList: LlmPiAi.Options['providerList'] = [
    { provider: 'alpha', apiKeyEnv: 'ST_S53_KEY', api: 'openai-completions', baseURL: alpha.url, models: [{ id: 'fast' }] },
    { provider: 'beta', apiKeyEnv: 'ST_S53_KEY', api: 'openai-completions', baseURL: beta.url, models: [{ id: 'deep' }] },
  ]
  const harness = await makeNetworkBridgeHarness({
    ...(options.persistenceRoot === undefined ? {} : { persistenceRoot: options.persistenceRoot }),
    provider: 'alpha',
    model: 'fast',
    llmMount: async (ctx: Context) => {
      await ctx.plugin(LlmPiAi, { providerList })
    },
  })
  return { harness, alpha, beta }
}

/** The grouped `model` select option, flattened to values, as a session create/resume response carries it. */
interface ModelOption {
  currentValue: string | undefined
  values: string[]
  groups: number
}

function modelOption(configOptions: SessionConfigOption[] | null | undefined): ModelOption {
  const option = configOptions?.find(entry => entry.id === 'model')
  if (option?.type !== 'select') throw new Error('expected the model select option')
  const values: string[] = []
  let groups = 0
  for (const entry of option.options as readonly (SessionConfigSelectOption | SessionConfigSelectGroup)[]) {
    if ('group' in entry) {
      groups += 1
      for (const inner of entry.options) values.push(inner.value)
    } else {
      values.push(entry.value)
    }
  }
  return { currentValue: option.currentValue, values, groups }
}

describe('multi-provider routes through llm-pi-ai (ST-S53-01)', () => {
  let harness: NetworkBridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
    await closeMockServers()
    vi.unstubAllEnvs()
  })

  it('switches providers over the network channel and keeps the selection across restart + resume', async () => {
    vi.stubEnv('ST_S53_KEY', 'test-key')
    const started = Date.now()
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-acp-multi-provider-'))
    try {
      const first = await bootHarness({ persistenceRoot })
      harness = first.harness

      const created = await harness.client.newSession({ cwd: persistenceRoot, mcpServers: [] })
      const sessionId = created.sessionId
      expect(modelOption(created.configOptions).groups).toBe(2)
      expect(modelOption(created.configOptions).values)
        .toEqual(expect.arrayContaining(['["alpha","fast"]', '["beta","deep"]']))
      expect(modelOption(created.configOptions).currentValue).toBe('["alpha","fast"]')

      const before = harness.updates.length
      await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'one' }] })
      expect(textOf(harness.updates.slice(before))).toBe('from-alpha')
      expect(first.alpha.requests).toHaveLength(1)
      expect(first.beta.requests).toHaveLength(0)

      await harness.client.setSessionConfigOption({ sessionId, configId: 'model', value: '["beta","deep"]' })
      const switched = harness.updates.length
      await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'two' }] })
      expect(textOf(harness.updates.slice(switched))).toBe('from-beta')
      expect(first.alpha.requests).toHaveLength(1)
      expect(first.beta.requests).toHaveLength(1)

      await harness.client.closeSession({ sessionId })
      await harness.dispose()
      harness = undefined

      // Fresh boot over the same persistence root: a real restart, not a reconnect.
      const second = await bootHarness({ persistenceRoot })
      harness = second.harness
      const resumed = await harness.client.resumeSession({ sessionId, cwd: persistenceRoot, mcpServers: [] })
      expect(modelOption(resumed.configOptions).currentValue).toBe('["beta","deep"]')

      const resumedBefore = harness.updates.length
      await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'three' }] })
      expect(textOf(harness.updates.slice(resumedBefore))).toBe('from-beta')
      expect(second.beta.requests).toHaveLength(1)
      expect(second.alpha.requests).toHaveLength(0)

      reportResult('ST-S53-01', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('ST-S53-01', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    } finally {
      await rm(persistenceRoot, { recursive: true, force: true })
    }
  })
})

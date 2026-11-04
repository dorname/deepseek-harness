/** S48 scenario coverage: catalog refresh, ACP switching, failure and empty catalogs. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { AcpModelControl } from '@deepseek-ai/dsh-acp'
import * as ApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import { reported } from './helpers/reporter.ts'

const PROVIDER = 'deepseek-official'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** Boot the real API-key provider in dynamic mode over one controlled endpoint. */
async function boot(baseURL: string, ttl: number): Promise<Context> {
  vi.stubEnv('DEEPSEEK_API_KEY', 'st-key')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ApiKey, { baseURL, discoveryCacheTtlMs: ttl })
  return ctx
}

function catalogBody(ids: readonly string[]): string {
  return JSON.stringify({ data: ids.map(id => ({ id, display_name: `Name ${id}` })) })
}

function choiceValues(options: Awaited<ReturnType<AcpModelControl['options']>>): string[] {
  const model = options.find(option => option.id === 'model')
  if (model?.type !== 'select') throw new Error('expected a model select option')
  return model.options.flatMap(group => 'group' in group ? group.options : [group]).map(choice => choice.value)
}

function currentValue(options: Awaited<ReturnType<AcpModelControl['options']>>): string {
  const model = options.find(option => option.id === 'model')
  if (model?.type !== 'select') throw new Error('expected a model select option')
  return model.currentValue
}

describe('S48 scenario coverage', () => {
  it('refreshes the ACP catalog from A/B to B/C and commits the exact successor id', async () => {
    await reported('ST-S48-01', async () => {
      // TTL 0 disables result reuse, so every options()/set() state build
      // re-reads the endpoint: one read for each of the two option reads,
      // one for the rejected stale choice, and two for the committed
      // successor's pre-commit states; the SSE entries feed the two
      // inference requests.
      const server = await mockServer([
        { kind: 'models', body: catalogBody(['model-a', 'model-b']) },
        { kind: 'models', body: catalogBody(['model-b', 'model-c']) },
        { kind: 'models', body: catalogBody(['model-b', 'model-c']) },
        { kind: 'models', body: catalogBody(['model-b', 'model-c']) },
        { kind: 'models', body: catalogBody(['model-b', 'model-c']) },
        { kind: 'sse', events: textEvents },
        { kind: 'sse', events: textEvents },
      ])
      const ctx = await boot(server.url, 0)
      const control = new AcpModelControl(ctx.llm, { provider: PROVIDER, model: 'model-a' })

      // First read: A is current and listed.
      const first = await control.options()
      expect(choiceValues(first)).toEqual([
        JSON.stringify([PROVIDER, 'model-a']),
        JSON.stringify([PROVIDER, 'model-b']),
      ])

      // TTL 0 forces the next read to the endpoint: the catalog refreshed to
      // B/C and the removed current model stays only as currentValue.
      const refreshed = await control.options()
      expect(choiceValues(refreshed)).toEqual([
        JSON.stringify([PROVIDER, 'model-b']),
        JSON.stringify([PROVIDER, 'model-c']),
      ])
      expect(currentValue(refreshed)).toBe(JSON.stringify([PROVIDER, 'model-a']))

      // The removed model can no longer be selected; its successor can.
      await expect(control.set('model', JSON.stringify([PROVIDER, 'model-a'])))
        .rejects.toThrow(/unknown model option/)
      await control.set('model', JSON.stringify([PROVIDER, 'model-c']))
      expect(control.selection.current).toEqual({ provider: PROVIDER, model: 'model-c' })

      // The committed id reaches the next inference request verbatim.
      await assemble(ctx, { model: 'model-c', messages: [] })
      expect((server.requests.at(-1) as { model?: string }).model).toBe('model-c')
    })
  })

  it('propagates catalog failures, publishes empty on success, and retries', async () => {
    await reported('ST-S48-02', async () => {
      // With reuse disabled, every catalog read consumes one `models`
      // behavior in order: the failure, the empty success, the recovery,
      // then the two state builds of the committed selection. The SSE
      // entries feed the two in-flight inference requests.
      const server = await mockServer([
        { kind: 'http-error', status: 500, body: '{"error":"upstream"}' },
        { kind: 'sse', events: textEvents },
        { kind: 'models', body: JSON.stringify({ data: [] }) },
        { kind: 'sse', events: textEvents },
        { kind: 'models', body: catalogBody(['model-recovered']) },
        { kind: 'models', body: catalogBody(['model-recovered']) },
        { kind: 'models', body: catalogBody(['model-recovered']) },
      ])
      const ctx = await boot(server.url, 0)
      const control = new AcpModelControl(ctx.llm, { provider: PROVIDER, model: 'model-a' })

      // A discovery failure rejects the options operation instead of
      // publishing static choices.
      await expect(control.options()).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })

      // Existing pure inference is independent of catalog availability.
      await assemble(ctx, { model: 'model-a', messages: [] })
      expect((server.requests.at(-1) as { model?: string }).model).toBe('model-a')

      // A successful empty catalog is empty — not an error, not a fallback.
      const empty = await control.options()
      expect(choiceValues(empty)).toEqual([])
      expect(currentValue(empty)).toBe(JSON.stringify([PROVIDER, 'model-a']))
      await assemble(ctx, { model: 'model-a', messages: [] })

      // A later successful discovery restores real choices and selection.
      const recovered = await control.options()
      expect(choiceValues(recovered)).toEqual([JSON.stringify([PROVIDER, 'model-recovered'])])
      await control.set('model', JSON.stringify([PROVIDER, 'model-recovered']))
      expect(control.selection.current).toEqual({ provider: PROVIDER, model: 'model-recovered' })
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { AcpModelControl } from '../src/model-control.ts'
import { reported } from './helpers/reporter.ts'

/** Report every case of this suite's OpenLogos id from the wrapping `it`. */
function c(name: string, fn: () => Promise<void>): void {
  it(name, () => reported('UT-S48-06', fn))
}

/** Minimal LLM catalog/runtime double for pure standard-option tests. */
function llmRuntime(overrides: Partial<LlmRuntime> = {}): LlmRuntime {
  return {
    listProviders: () => [{ id: 'mock', name: 'Mock' }],
    listModels: () => Promise.resolve([{ provider: 'mock', id: 'mock', name: 'Mock' }]),
    resolveCallConfig: (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
      provider: selection.provider ?? 'mock',
      model: selection.model ?? 'mock',
      ...selection.reasoningEffort === undefined
        ? { reasoningEffort: ReasoningEffortId('high') }
        : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
    }),
    resolveModelInfo: (provider: string, model: string) => Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low', description: 'Less thought.' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    }),
    ...overrides,
  } as unknown as LlmRuntime
}

describe('ACP model configuration control', () => {
  c('represents an absent route and validates value types before mutation', async () => {
    const control = new AcpModelControl(llmRuntime(), undefined)

    expect(control.snapshot()).toBeUndefined()
    await expect(control.options()).resolves.toEqual([])
    await expect(control.set('model', false)).rejects.toThrow(/requires a select value/)
    await expect(control.set('model', 'missing')).rejects.toThrow(/no model selection/)

    control.selection.current = { provider: 'mock', model: 'mock' }
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  c('keeps an unlisted current route out of advertised choices and exposes reasoning descriptions', async () => {
    const control = new AcpModelControl(llmRuntime({ listProviders: () => [] }), {
      provider: 'private',
      model: 'unlisted',
    })

    const options = await control.options()

    const model = options.find(option => option.id === 'model')
    const reasoning = options.find(option => option.id === 'reasoning_effort')
    expect(model).toMatchObject({
      type: 'select',
      currentValue: '["private","unlisted"]',
      options: [],
    })
    expect(reasoning).toMatchObject({
      type: 'select',
      currentValue: 'high',
      options: [{ name: 'Low', description: 'Less thought.' }, { name: 'High' }],
    })

    control.pinTurn(3, { provider: 'turn', model: 'pinned' })
    expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
    control.releaseTurn(2)
    expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
    control.releaseTurn(3)
    expect(control.selection.current).toEqual({ provider: 'private', model: 'unlisted' })
  })

  c('rejects the complete option state when provider discovery fails', async () => {
    const listModels = vi.fn(() => Promise.reject(new Error('catalog unavailable')))
    const control = new AcpModelControl(llmRuntime({ listModels }), { provider: 'mock', model: 'mock' })

    await expect(control.options()).rejects.toThrow('catalog unavailable')

    expect(listModels).toHaveBeenCalledWith('mock', undefined)
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  c('returns an empty model select for a successful empty catalog', async () => {
    const control = new AcpModelControl(llmRuntime({ listModels: () => Promise.resolve([]) }), {
      provider: 'mock',
      model: 'mock',
    })

    const options = await control.options()

    expect(options.find(option => option.id === 'model')).toMatchObject({
      type: 'select',
      currentValue: '["mock","mock"]',
      options: [],
    })
  })

  c('forwards the caller signal to every provider catalog lookup', async () => {
    const listModels = vi.fn(() => Promise.resolve([]))
    const control = new AcpModelControl(llmRuntime({
      listProviders: () => [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }],
      listModels,
    }), { provider: 'mock', model: 'mock' })
    const controller = new AbortController()

    await control.options(controller.signal)

    expect(listModels).toHaveBeenNthCalledWith(1, 'first', controller.signal)
    expect(listModels).toHaveBeenNthCalledWith(2, 'second', controller.signal)
  })

  c('rejects a stale dynamic model choice without changing selection', async () => {
    let plainAdvertised = true
    const control = new AcpModelControl(llmRuntime({
      listModels: () => Promise.resolve([
        { provider: 'mock', id: 'mock', name: 'Mock' },
        ...plainAdvertised ? [{ provider: 'mock', id: 'plain', name: 'Plain' }] : [],
      ]),
    }), { provider: 'mock', model: 'mock' })
    const initial = await control.options()
    const model = initial.find(option => option.id === 'model')
    if (model?.type !== 'select') throw new Error('expected model options')
    const choices = model.options.flatMap(option => 'group' in option ? option.options : [option])
    expect(choices.map(choice => choice.value)).toContain('["mock","plain"]')
    plainAdvertised = false

    await expect(control.set('model', '["mock","plain"]')).rejects.toThrow(/unknown model option/)

    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  c('does not commit model or reasoning changes when post-mutation discovery fails', async () => {
    let catalogCalls = 0
    const control = new AcpModelControl(llmRuntime({
      listModels: () => {
        catalogCalls += 1
        return catalogCalls > 2
          ? Promise.reject(new Error('refresh failed'))
          : Promise.resolve([
            { provider: 'mock', id: 'mock', name: 'Mock' },
            { provider: 'mock', id: 'plain', name: 'Plain' },
          ])
      },
    }), { provider: 'mock', model: 'mock' })
    await control.options()

    await expect(control.set('model', '["mock","plain"]')).rejects.toThrow('refresh failed')
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
    await expect(control.set('reasoning_effort', 'low')).rejects.toThrow('refresh failed')
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  c('rejects an unadvertised reasoning effort and accepts a later valid change', async () => {
    const control = new AcpModelControl(llmRuntime(), { provider: 'mock', model: 'mock' })

    await expect(control.set('reasoning_effort', 'extreme')).rejects.toThrow(/unknown reasoning effort/)
    const options = await control.set('reasoning_effort', 'low')

    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: 'low' })
  })

  c('exposes and restores a provider-owned reasoning default', async () => {
    const runtime = llmRuntime({
      resolveCallConfig: (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
        provider: selection.provider ?? 'mock',
        model: selection.model ?? 'mock',
        ...selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
      }),
      resolveModelInfo: (provider: string, model: string) => Promise.resolve({
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('low'), name: 'Low' },
            { id: ReasoningEffortId('high'), name: 'High' },
          ],
        },
      }),
    })
    const control = new AcpModelControl(runtime, { provider: 'mock', model: 'mock' })

    const initial = await control.options()
    expect(initial.find(option => option.id === 'reasoning_effort')).toMatchObject({
      currentValue: '',
      options: [{ value: '', name: 'Provider default' }, { value: 'low' }, { value: 'high' }],
    })
    await control.set('reasoning_effort', 'low')
    const restored = await control.set('reasoning_effort', '')

    expect(restored.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: '' })
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })
})

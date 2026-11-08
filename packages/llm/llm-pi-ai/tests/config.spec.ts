import { describe, expect, it } from 'vitest'
import {
  assertServiceable,
  Config,
  resolveProfiles,
  resolveProviderSection,
  type Options,
  type PiAiProviderListEntry,
  type PiAiProviderProfile,
} from '../src/config.ts'

/** Validate one hand-declared route, with the caller's fields layered onto it. */
const routeWith = (profile: Record<string, unknown>): (() => unknown) =>
  () => ({ providers: Config({
    providers: {
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        ...profile,
      },
    },
  }).providers.get() })

/** Validate that route with the caller's fields on its single model entry. */
const configWith = (model: Record<string, unknown>): (() => unknown) =>
  routeWith({ models: [{ id: 'm', ...model }] })

describe('reasoning schema boundary', () => {
  it('accepts an empty provider section and propagates unexpected catalog failures', () => {
    expect(() => { assertServiceable({}) }).not.toThrow()
    const failure = new TypeError('model metadata lookup failed')
    expect(() => resolveProfiles({ openrouter: { models: [{
      id: '111',
      get name(): string { throw failure },
    }], api: 'openai-completions' } }, 'deferred')).toThrow(failure)
  })

  it('rejects a level pi-ai does not know at the write that produced it', () => {
    expect(configWith({ reasoningEfforts: { ultra: 'x' } })).toThrow(/"off"/)
    expect(configWith({ reasoningEfforts: { high: 42 } })).toThrow()
  })

  it('keeps false distinguishable from an absent declaration', () => {
    type Materialized = { providers: Record<string, { models?: { reasoningEfforts?: unknown }[] }> }
    const withFalse = configWith({ reasoningEfforts: false })() as Materialized
    expect(withFalse.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBe(false)
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBeUndefined()
  })

  it('rejects a thinking format outside the offered set', () => {
    expect(configWith({ compat: { thinkingFormat: 'quantum' } })).toThrow(/expected/)
  })

  it('accepts Baseten template arguments and completion controls', () => {
    expect(configWith({
      compat: {
        supportsFinishReason: false,
        thinkingFormat: 'baseten',
        chatTemplateArgs: { enable_thinking: { $var: 'thinking.enabled' } },
        supportsThinkingTokenBudget: true,
      },
    })).not.toThrow()
  })
})

describe('modality schema boundary', () => {
  it('rejects a modality pi-ai does not know, at either level', () => {
    expect(configWith({ input: ['audio'] })).toThrow(/expected/)
    expect(routeWith({ defaultInput: ['text', 'audio'] })).toThrow(/expected/)
  })

  it('refuses a route whose models could accept nothing', () => {
    // The pair the settings seam runs: the schema accepts the empty list as
    // well-typed, and the namespace validator is what refuses it. Asserting
    // only the schema would report this route as writable.
    expect(routeWith({ defaultInput: [] })).not.toThrow()
    expect(() => { assertServiceable(routeWith({ defaultInput: [] })() as Options) })
      .toThrow(/defaultInput must name at least one modality/)
  })

  type Materialized = {
    providers: Record<string, { defaultInput?: unknown; models?: { input?: unknown }[] }>
  }

  it('materializes an absent entry list as empty and an absent route list as text', () => {
    // The empty-list inheritance rule exists because of exactly this: an entry
    // that declares nothing reaches resolution as `[]`, not as `undefined`.
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.input).toEqual([])
    expect(absent.providers['acme-gateway']?.defaultInput).toEqual(['text'])
  })
})

describe('request image policy bounds', () => {
  it.each([
    ['requestImagePixelBudget', 0, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImagePixelBudget', Number.MAX_SAFE_INTEGER + 1, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImageMaxBytes', 0, /requestImageMaxBytes must be a positive safe integer/],
    ['requestImageMaxBytes', 1.5, /requestImageMaxBytes must be a positive safe integer/],
  ] as const)('rejects %s=%s at service resolution', (field, value, message) => {
    const programmatic = {
      providers: {
        'acme-gateway': {
          api: 'openai-completions',
          baseURL: 'https://acme.test',
          models: [{ id: 'm' }],
          [field]: value,
        },
      },
    } as Options
    expect(() => {
      assertServiceable(programmatic)
    }).toThrow(message)
  })
})

describe('provider list form boundary', () => {
  /** Resolve the effective section the way the plugin does: the volatile node read, then the section resolver. */
  const sectionOf = (config: Partial<Options>): Record<string, PiAiProviderProfile> => {
    const resolved = Config(config)
    // The volatile read is a deep-readonly snapshot; the resolver's dict is mutable.
    const providers = structuredClone(resolved.providers.get()) as Record<string, PiAiProviderProfile>
    return resolveProviderSection({ providers, providerList: resolved.providerList })
  }

  const listRoutes: NonNullable<Options['providerList']> = [
    { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY' },
    {
      provider: 'acme-gateway',
      apiKeyEnv: 'ACME_GATEWAY_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://acme.test/v1',
      models: [{ id: 'm' }],
    },
  ]

  const dictRoutes = {
    openai: { apiKeyEnv: 'OPENAI_API_KEY' },
    'acme-gateway': {
      apiKeyEnv: 'ACME_GATEWAY_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://acme.test/v1',
      models: [{ id: 'm' }],
    },
  }

  it('normalizes a list into the section an equivalent dict names, in declaration order', () => {
    const fromList = sectionOf({ providerList: [...listRoutes] })
    const fromDict = sectionOf({ providers: dictRoutes })
    expect(Object.keys(fromList)).toEqual(Object.keys(fromDict))
    expect(fromList).toEqual(fromDict)
  })

  it('resolves the normalized list through the same profile pipeline as the dict', () => {
    const fromList = resolveProfiles(sectionOf({ providerList: [...listRoutes] }), 'deferred')
    const fromDict = resolveProfiles(sectionOf({ providers: dictRoutes }), 'deferred')
    // `piProvider` holds per-resolution class instances, so equivalence is
    // asserted on the resolved facts a consumer acts on.
    const stable = (profiles: ReturnType<typeof resolveProfiles>) =>
      [...profiles.entries()].map(([route, profile]) => ({
        route,
        displayName: profile.displayName,
        apiKeyEnv: profile.apiKeyEnv,
        catalogError: profile.catalogError,
        modelErrors: [...profile.modelErrors],
        configuredMaxTokens: [...profile.configuredMaxTokens],
      }))
    expect(stable(fromList)).toEqual(stable(fromDict))
  })

  it('refuses both supply forms naming routes', () => {
    expect(() => sectionOf({ providers: dictRoutes, providerList: [...listRoutes] }))
      .toThrow(/providers and providerList both supply routes/)
  })

  it('refuses a duplicate route key and an empty route key, naming the entry', () => {
    expect(() => sectionOf({ providerList: [
      { provider: 'acme-gateway', apiKeyEnv: 'ACME_GATEWAY_API_KEY' },
      { provider: 'acme-gateway', apiKeyEnv: 'OTHER_KEY' },
    ] })).toThrow(/declares route "acme-gateway" more than once/)
    expect(() => sectionOf({ providerList: [{ provider: '', apiKeyEnv: 'ACME_GATEWAY_API_KEY' }] }))
      .toThrow(/entry 0 needs a non-empty "provider" route key/)
  })

  it('rejects a list entry without a route key at the schema boundary', () => {
    expect(() => Config({ providerList: [{ apiKeyEnv: 'ACME_GATEWAY_API_KEY' }] as PiAiProviderListEntry[] }))
      .toThrow(/provider/)
  })

  it('keeps the dict form refusing an inline route key', () => {
    expect(() => {
      assertServiceable({
        providers: {
          'acme-gateway': {
            api: 'openai-completions',
            baseURL: 'https://acme.test',
            models: [{ id: 'm' }],
            provider: 'renamed',
          } as PiAiProviderProfile,
        },
      })
    }).toThrow(/moved to the providers dict key/)
  })

  it('validates a list-supplied route at the service boundary', () => {
    expect(() => {
      assertServiceable({
        providerList: [
          { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY' },
          { provider: 'acme-gateway', apiKeyEnv: 'ACME_GATEWAY_API_KEY', api: 'openai-completions', baseURL: 'https://acme.test', models: [{ id: 'm' }] },
        ],
      })
    }).not.toThrow()
    expect(() => {
      assertServiceable({
        providerList: [{ provider: 'acme-gateway', requestImageMaxBytes: 1.5 }],
      })
    }).toThrow(/requestImageMaxBytes must be a positive safe integer/)
  })
})

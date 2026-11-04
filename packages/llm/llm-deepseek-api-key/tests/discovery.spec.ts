/** Dynamic catalog behavior for the DeepSeek API-key provider. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmError } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reported } from './helpers/reporter.ts'

/** Report every case of one OpenLogos id from the wrapping `it`. */
function ut(id: string): (name: string, fn: () => Promise<void>) => void {
  return (name, fn) => { it(name, async () => { await reported(id, fn) }) }
}
import * as ApiKey from '../src/index.ts'
import { resolveAdapterOptions } from '../src/config.ts'
import type { Options, ResolvedDeepSeekOptions } from '../src/config.ts'
import { DeepSeekModelDiscovery } from '../src/discovery.ts'

const PROVIDER = 'deepseek-official'
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const discoveries: DeepSeekModelDiscovery[] = []

function connection(overrides: Options = {}): ResolvedDeepSeekOptions {
  return resolveAdapterOptions({ baseURL: 'https://gateway.example/anthropic', ...overrides })
}

function discovery(): DeepSeekModelDiscovery {
  const instance = new DeepSeekModelDiscovery()
  discoveries.push(instance)
  return instance
}

function listReply(rows: readonly unknown[], init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ data: rows }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function fetchStub(implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  const stub = vi.fn<typeof globalThis.fetch>(implementation)
  vi.stubGlobal('fetch', stub)
  return stub
}

function requestedUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

async function expectLlmError(promise: Promise<unknown>, code: string): Promise<LlmError> {
  try {
    await promise
  } catch (error: unknown) {
    if (!(error instanceof LlmError)) throw error
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`expected ${code} rejection`)
}

async function models(
  instance: DeepSeekModelDiscovery,
  options: ResolvedDeepSeekOptions,
  key = 'sk-current',
  signal?: AbortSignal,
) {
  return instance.discover(PROVIDER, options, async () => key, signal)
}

afterEach(async () => {
  await Promise.all(discoveries.splice(0).map(async instance => instance.dispose()))
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('UT-S48-01 dynamic replacement, overrides, and exact parsing', () => {
  const c = ut('UT-S48-01')
  c('publishes only the endpoint catalog through the real provider registration', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test')
    fetchStub(async () => listReply([{ id: 'deepseek-v4-flash', name: 'V4 Flash' }]))
    const ctx = new Context()
    try {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(ApiKey, { baseURL: 'https://gateway.example/anthropic' })

      const catalog = await ctx.llm.listModels(PROVIDER)

      expect(catalog).toEqual([{ provider: PROVIDER, id: 'deepseek-v4-flash', name: 'V4 Flash' }])
      expect(catalog).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'deepseek-flash' })]))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  c('preserves exact ids, label precedence, first-wins order, and successful empty listings', async () => {
    const fetch = fetchStub(async () => listReply([
      { id: 'deepseek-v4-flash', name: 'Name', display_name: 'Ignored', displayName: 'Ignored', contextWindow: 123 },
      { id: 'model-b', display_name: 'Display B', displayName: 'Ignored' },
      { id: 'model-c', displayName: 'Display C' },
      { id: 'model-d' },
      { id: 'deepseek-v4-flash', name: 'Duplicate' },
      { id: '' }, { id: 42 }, null, [],
    ]))
    const instance = discovery()

    const catalog = await models(instance, connection())

    expect(catalog).toEqual([
      { provider: PROVIDER, id: 'deepseek-v4-flash', name: 'Name' },
      { provider: PROVIDER, id: 'model-b', name: 'Display B' },
      { provider: PROVIDER, id: 'model-c', name: 'Display C' },
      { provider: PROVIDER, id: 'model-d', name: 'model-d' },
    ])
    expect(catalog[0]).not.toHaveProperty('contextWindow')
    fetch.mockResolvedValueOnce(listReply([]))
    const empty = await models(instance, connection({ discoveryCacheTtlMs: 0 }))
    expect(empty).toEqual([])
  })

  c('uses explicit model arrays, including an empty array, without credentials or network', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'invalid\nheader')
    const fetch = fetchStub(async () => listReply([{ id: 'endpoint-model' }]))
    for (const configured of [[{ id: 'manual-model' }], []]) {
      const ctx = new Context()
      try {
        await ctx.plugin(LlmRuntime)
        await ctx.plugin(ApiKey, { models: configured })

        await expect(ctx.llm.listModels(PROVIDER)).resolves.toEqual(configured.map(model => ({
          provider: PROVIDER,
          id: model.id,
          name: model.id,
          inputModalities: ['text'],
        })))
      } finally {
        await ctx.fiber.dispose()
      }
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  c('validates discovery settings and records their resolved defaults', async () => {
    expect(connection()).toMatchObject({
      modelsSource: 'endpoint',
      discoveryTimeoutMs: 10_000,
      discoveryCacheTtlMs: 30_000,
    })
    expect(connection({ models: [] })).toMatchObject({ modelsSource: 'config', models: [] })
    expect(() => connection({ discoveryTimeoutMs: 0 })).toThrow(/discoveryTimeoutMs/)
    expect(() => connection({ discoveryCacheTtlMs: -1 })).toThrow(/discoveryCacheTtlMs/)
  })
})

describe('UT-S48-02 URL, authentication, and credential isolation', () => {
  const c = ut('UT-S48-02')
  it.each([
    ['https://gateway.example/anthropic/', 'https://gateway.example/anthropic/v1/models'],
    ['https://gateway.example/anthropic/v1', 'https://gateway.example/anthropic/v1/models'],
    ['https://gateway.example/prefix/anthropic', 'https://gateway.example/prefix/anthropic/v1/models'],
  ])('lists %s at %s with the current route credentials', async (baseURL, expected) => {
    await reported('UT-S48-02', async () => {
      const fetch = fetchStub(async () => listReply([]))
      const key = 'sk-url-secret'

      await models(discovery(), connection({ baseURL }), key)

      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, init] = fetch.mock.calls[0]!
      expect(requestedUrl(url)).toBe(expected)
      const headers = new Headers(init?.headers)
      expect(headers.get('x-api-key')).toBe(key)
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      expect(headers.get('accept')).toBe('application/json')
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    })
  })

  c('falls back to stripped-suffix origin candidates only on a 404 or 405 primary', async () => {
    await reported('UT-S48-02', async () => {
      const fetch = fetchStub(async (input) => {
        const href = requestedUrl(input)
        return href === 'https://api.example.com/anthropic/v1/models' || href === 'https://api.example.com/v1/models'
          ? new Response('not found', { status: 404 })
          : listReply([{ id: 'origin-model' }])
      })
      const key = 'sk-chain-secret'

      const catalog = await models(discovery(), connection({ baseURL: 'https://api.example.com/anthropic' }), key)

      expect(catalog).toEqual([{ provider: PROVIDER, id: 'origin-model', name: 'origin-model' }])
      expect(fetch.mock.calls.map(call => requestedUrl(call[0]))).toEqual([
        'https://api.example.com/anthropic/v1/models',
        'https://api.example.com/v1/models',
        'https://api.example.com/models',
      ])
      for (const [, init] of fetch.mock.calls) {
        const headers = new Headers(init?.headers)
        expect(headers.get('x-api-key')).toBe(key)
        expect(headers.get('anthropic-version')).toBe('2023-06-01')
      }
    })
    await reported('UT-S48-02', async () => {
      const fetch = fetchStub(async input => (requestedUrl(input).endsWith('/v1/models')
        ? new Response('', { status: 405 })
        : listReply([{ id: 'after-405' }])))

      const catalog = await models(discovery(), connection())

      expect(catalog).toEqual([{ provider: PROVIDER, id: 'after-405', name: 'after-405' }])
      expect(fetch).toHaveBeenCalledTimes(3)
    })
  })

  c('fails on the first candidate for auth, server, and parse errors without hopping', async () => {
    await reported('UT-S48-02', async () => {
      for (const [respond, messagePart] of [
        [() => new Response('denied', { status: 401 }), 'answered 401; check the API key'],
        [() => new Response('boom', { status: 500 }), 'answered 500'],
        [() => new Response('<html>busy</html>', { status: 200 }), 'did not return a JSON model listing'],
      ] as const) {
        const fetch = fetchStub(async () => respond())

        const error = await expectLlmError(models(discovery(), connection()), 'DISCOVERY_FAILED')

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(error.message).toContain(messagePart)
        expect(error.message).not.toContain('sk-current')
      }
    })
  })

  c('reports every attempted endpoint when the chain exhausts, including the single-candidate case', async () => {
    await reported('UT-S48-02', async () => {
      const fetch = fetchStub(async () => new Response('', { status: 404 }))

      const error = await expectLlmError(
        models(discovery(), connection({ baseURL: 'https://plain.example/v1' })),
        'DISCOVERY_FAILED',
      )

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(error.message).toBe('no model listing endpoint at https://plain.example/v1/models (last status 404)')
      expect(error.failure.status).toBe(404)
    })
    await reported('UT-S48-02', async () => {
      const fetch = fetchStub(async () => new Response('', { status: 404 }))

      const error = await expectLlmError(
        models(discovery(), connection({ baseURL: 'https://api.example.com/anthropic' })),
        'DISCOVERY_FAILED',
      )

      expect(fetch).toHaveBeenCalledTimes(3)
      expect(error.message).toBe(
        'no model listing endpoint at https://api.example.com/anthropic/v1/models, '
        + 'https://api.example.com/v1/models, https://api.example.com/models (last status 404)',
      )
    })
  })

  c('isolates cached results by credential and never includes a raw key in classified errors', async () => {
    const firstKey = 'sk-first-secret'
    const secondKey = 'sk-second-secret'
    let key = firstKey
    const fetch = fetchStub(async (_input, init) => listReply([
      { id: new Headers(init?.headers).get('x-api-key') === firstKey ? 'first-catalog' : 'second-catalog' },
    ]))
    const instance = discovery()
    const options = connection()

    expect((await models(instance, options, key))[0]?.id).toBe('first-catalog')
    key = secondKey
    expect((await models(instance, options, key))[0]?.id).toBe('second-catalog')
    key = firstKey
    expect((await models(instance, options, key))[0]?.id).toBe('first-catalog')
    expect(fetch).toHaveBeenCalledTimes(2)

    fetchStub(async () => { throw new TypeError(`transport echoed ${firstKey}`) })
    const error = await expectLlmError(models(instance, connection({ baseURL: 'https://failure.example' }), firstKey), 'DISCOVERY_FAILED')
    expect(error.message).not.toContain(firstKey)
    expect(error.message).not.toContain(secondKey)
  })
})

describe('UT-S48-03 successful caching and singleflight', () => {
  const c = ut('UT-S48-03')
  c('coalesces concurrent calls, reuses success until TTL expiry, and detaches every result', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const pending = Promise.withResolvers<Response>()
    const fetch = fetchStub(() => pending.promise)
    const instance = discovery()
    const options = connection()
    const first = models(instance, options)
    const second = models(instance, options)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    pending.resolve(listReply([{ id: 'model-a', name: 'Original' }]))
    const [firstResult, secondResult] = await Promise.all([first, second])
    firstResult[0]!.name = 'Mutated'
    firstResult.push({ provider: PROVIDER, id: 'injected', name: 'Injected' })

    expect(secondResult).toEqual([{ provider: PROVIDER, id: 'model-a', name: 'Original' }])
    expect(await models(instance, options)).toEqual(secondResult)
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 30_000
    fetch.mockResolvedValueOnce(listReply([{ id: 'model-b' }]))
    expect((await models(instance, options))[0]?.id).toBe('model-b')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  c('keeps singleflight with zero TTL but does not reuse completed results', async () => {
    const pending = Promise.withResolvers<Response>()
    const fetch = fetchStub(() => pending.promise)
    const instance = discovery()
    const options = connection({ discoveryCacheTtlMs: 0 })
    const first = models(instance, options)
    const second = models(instance, options)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    pending.resolve(listReply([]))
    await Promise.all([first, second])

    fetch.mockResolvedValueOnce(listReply([{ id: 'after-zero-ttl' }]))
    expect((await models(instance, options))[0]?.id).toBe('after-zero-ttl')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  c('isolates endpoint and discovery-setting generations', async () => {
    const fetch = fetchStub(async () => listReply([]))
    const instance = discovery()

    await models(instance, connection({ baseURL: 'https://one.example' }))
    await models(instance, connection({ baseURL: 'https://two.example' }))
    await models(instance, connection({ baseURL: 'https://one.example', discoveryCacheTtlMs: 1 }))

    expect(fetch).toHaveBeenCalledTimes(3)
  })

  c('caches successful empty catalogs but retries failures immediately', async () => {
    const fetch = fetchStub(async () => listReply([]))
    const instance = discovery()
    const options = connection()
    await models(instance, options)
    await models(instance, options)
    expect(fetch).toHaveBeenCalledTimes(1)

    const retry = discovery()
    const retryOptions = connection({ baseURL: 'https://retry.example' })
    fetch.mockRejectedValueOnce(new TypeError('offline'))
    await expectLlmError(models(retry, retryOptions), 'DISCOVERY_FAILED')
    fetch.mockResolvedValueOnce(listReply([{ id: 'recovered' }]))
    expect((await models(retry, retryOptions))[0]?.id).toBe('recovered')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('UT-S48-04 deadlines, cancellation, response bounds, and disposal', () => {
  const c = ut('UT-S48-04')
  c('classifies a response-header deadline and aborts its transport', async () => {
    let transportSignal: AbortSignal | null | undefined
    fetchStub((_input, init) => {
      transportSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        transportSignal?.addEventListener('abort', () => { reject(new Error('transport aborted')) }, { once: true })
      })
    })

    const error = await expectLlmError(models(discovery(), connection({ discoveryTimeoutMs: 5 })), 'TIMEOUT')

    expect(error.message).toContain('5ms')
    expect(transportSignal?.aborted).toBe(true)
  })

  c('applies the deadline while reading the response body', async () => {
    const bodyStarted = Promise.withResolvers<undefined>()
    fetchStub(async (_input, init) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('expected a discovery signal')
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          bodyStarted.resolve(undefined)
          signal.addEventListener('abort', () => { stream.error(new Error('body aborted')) }, { once: true })
        },
      }))
    })
    const instance = discovery()
    const result = models(instance, connection({ discoveryTimeoutMs: 5 }))
    await bodyStarted.promise

    await expectLlmError(result, 'TIMEOUT')
  })

  c('cancels one waiter without aborting a shared request used by another', async () => {
    const pending = Promise.withResolvers<Response>()
    let transportSignal: AbortSignal | null | undefined
    const fetch = fetchStub((_input, init) => {
      transportSignal = init?.signal
      return pending.promise
    })
    const instance = discovery()
    const options = connection()
    const first = new AbortController()
    const cancelled = models(instance, options, 'sk-current', first.signal)
    const remaining = models(instance, options)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    first.abort()
    await expectLlmError(cancelled, 'ABORTED')
    expect(transportSignal?.aborted).toBe(false)

    pending.resolve(listReply([{ id: 'survived' }]))
    expect((await remaining)[0]?.id).toBe('survived')
  })

  c('aborts after the last waiter cancels and refuses to cache a late success', async () => {
    const late = Promise.withResolvers<Response>()
    let transportSignal: AbortSignal | null | undefined
    const fetch = fetchStub((_input, init) => {
      transportSignal = init?.signal
      return late.promise
    })
    const instance = discovery()
    const options = connection()
    const first = new AbortController()
    const second = new AbortController()
    const one = models(instance, options, 'sk-current', first.signal)
    const two = models(instance, options, 'sk-current', second.signal)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    first.abort()
    second.abort()
    await Promise.all([expectLlmError(one, 'ABORTED'), expectLlmError(two, 'ABORTED')])
    expect(transportSignal?.aborted).toBe(true)

    late.resolve(listReply([{ id: 'late-result' }]))
    fetch.mockResolvedValueOnce(listReply([{ id: 'fresh-result' }]))
    expect((await models(instance, options))[0]?.id).toBe('fresh-result')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  c('cleans up when cancellation happens as the transport starts', async () => {
    const caller = new AbortController()
    const late = Promise.withResolvers<Response>()
    let transportSignal: AbortSignal | null | undefined
    const fetch = fetchStub((_input, init) => {
      transportSignal = init?.signal
      caller.abort()
      return late.promise
    })
    const instance = discovery()
    const options = connection()

    await expectLlmError(models(instance, options, 'sk-current', caller.signal), 'ABORTED')
    expect(transportSignal?.aborted).toBe(true)
    late.resolve(listReply([{ id: 'late-result' }]))
    fetch.mockResolvedValueOnce(listReply([{ id: 'fresh-result' }]))
    expect((await models(instance, options))[0]?.id).toBe('fresh-result')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  c('rejects declared and streamed responses over four MiB', async () => {
    const instance = discovery()
    const declaredOptions = connection({ baseURL: 'https://declared.example' })
    fetchStub(async () => new Response('not read', {
      headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
    }))
    const declared = await expectLlmError(models(instance, declaredOptions), 'DISCOVERY_FAILED')
    expect(declared.message).toContain('4194304 bytes')

    const streamedOptions = connection({ baseURL: 'https://streamed.example' })
    fetchStub(async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), {
      headers: { 'content-length': '1' },
    }))
    const streamed = await expectLlmError(models(instance, streamedOptions), 'DISCOVERY_FAILED')
    expect(streamed.message).toContain('4194304 bytes')
  })

  c('aborts and awaits outstanding transport during disposal', async () => {
    const late = Promise.withResolvers<Response>()
    let transportSignal: AbortSignal | null | undefined
    const fetch = fetchStub((_input, init) => {
      transportSignal = init?.signal
      return late.promise
    })
    const instance = discovery()
    const options = connection()
    const pending = models(instance, options)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })

    const disposed = instance.dispose()
    expect(transportSignal?.aborted).toBe(true)
    late.resolve(listReply([{ id: 'late-result' }]))
    await disposed

    await expectLlmError(pending, 'ABORTED')
    await expectLlmError(models(instance, options), 'ABORTED')
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(instance.dispose()).resolves.toBeUndefined()
  })

  c('rejects promptly when the caller aborts during credential resolution', async () => {
    const credential = Promise.withResolvers<string>()
    const fetch = fetchStub(async () => listReply([{ id: 'unused' }]))
    const instance = discovery()
    const caller = new AbortController()
    const pending = instance.discover(PROVIDER, connection(), () => credential.promise, caller.signal)
    caller.abort()
    await expectLlmError(pending, 'ABORTED')

    // The abandoned credential resolution stays owned by its resolver; no
    // transport may start for the late settlement.
    credential.resolve('sk-late')
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(fetch).not.toHaveBeenCalled()
  })

  c('rejects when disposal wins the race against credential resolution', async () => {
    const credential = Promise.withResolvers<string>()
    const fetch = fetchStub(async () => listReply([{ id: 'unused' }]))
    const instance = discovery()
    const pending = instance.discover(PROVIDER, connection(), () => credential.promise)
    const disposed = instance.dispose()
    credential.resolve('sk-late')
    await disposed
    await expectLlmError(pending, 'ABORTED')
    expect(fetch).not.toHaveBeenCalled()
  })

  c('propagates a credential rejection for a signal-bearing caller', async () => {
    const instance = discovery()
    await expectLlmError(
      instance.discover(
        PROVIDER,
        connection(),
        () => Promise.reject(new LlmError('credential rejected', 'INVALID_CREDENTIAL')),
        new AbortController().signal,
      ),
      'INVALID_CREDENTIAL',
    )
  })

  c('serves a signal-bearing caller through a successful discovery', async () => {
    const fetch = fetchStub(async () => listReply([{ id: 'served' }]))
    await expect(models(discovery(), connection(), 'sk-current', new AbortController().signal)).resolves.toEqual([
      { provider: PROVIDER, id: 'served', name: 'served' },
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  c('propagates a transport failure through a signal-bearing caller', async () => {
    fetchStub(async () => new Response('upstream', { status: 500 }))
    const error = await expectLlmError(
      models(discovery(), connection(), 'sk-current', new AbortController().signal),
      'DISCOVERY_FAILED',
    )
    expect(error.failure.status).toBe(500)
  })

  c('treats a bodyless success as an invalid listing', async () => {
    fetchStub(async () => new Response(null, { status: 200 }))
    const error = await expectLlmError(models(discovery(), connection()), 'DISCOVERY_FAILED')
    expect(error.message).toContain('did not return a JSON model listing')
  })

  c('ignores a caller abort that arrives after its release', async () => {
    const pending = Promise.withResolvers<Response>()
    let transportSignal: AbortSignal | null | undefined
    const fetch = fetchStub((_input, init) => {
      transportSignal = init?.signal
      return pending.promise
    })
    const instance = discovery()
    const caller = new AbortController()
    const served = models(instance, connection(), 'sk-current', caller.signal)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    pending.resolve(listReply([{ id: 'settled' }]))
    expect((await served)[0]?.id).toBe('settled')
    caller.abort()
    expect(transportSignal?.aborted).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('UT-S48-05 discovery errors and credential failures', () => {
  const c = ut('UT-S48-05')
  it.each([401, 403, 404, 429, 500])('preserves HTTP status %s without exposing its response body', async (status) => {
    const secret = `sk-http-${status}-secret`
    fetchStub(async () => new Response(`upstream secret ${secret}`, { status }))

    const error = await expectLlmError(models(discovery(), connection(), secret), 'DISCOVERY_FAILED')

    expect(error.failure.status).toBe(status)
    expect(error.message).toContain(String(status))
    expect(error.message).not.toContain(secret)
  })

  it.each([
    ['not json', /did not return a JSON model listing/],
    ['{}', /expected an object with a data array/],
    ['{"data":{}}', /expected an object with a data array/],
    ['[]', /expected an object with a data array/],
  ])('rejects malformed listing %s without static fallback', async (body, message) => {
    await reported('UT-S48-05', async () => {
      fetchStub(async () => new Response(body, { status: 200 }))

      const error = await expectLlmError(models(discovery(), connection()), 'DISCOVERY_FAILED')

      expect(error.message).toMatch(message)
    })
  })

  c('distinguishes missing and unusable credentials from endpoint discovery', async () => {
    const fetch = fetchStub(async () => listReply([{ id: 'must-not-appear' }]))
    for (const [key, code] of [['', 'MISSING_CREDENTIAL'], ['invalid\nheader', 'INVALID_CREDENTIAL']] as const) {
      vi.stubEnv('DEEPSEEK_API_KEY', key)
      const ctx = new Context()
      try {
        await ctx.plugin(LlmRuntime)
        await ctx.plugin(ApiKey, {})
        await expectLlmError(ctx.llm.listModels(PROVIDER), code)
      } finally {
        await ctx.fiber.dispose()
      }
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  c('honors cancellation before credential resolution', async () => {
    const instance = discovery()
    const controller = new AbortController()
    controller.abort()
    const resolve = vi.fn(async () => 'sk-unused')

    await expectLlmError(instance.discover(PROVIDER, connection(), resolve, controller.signal), 'ABORTED')

    expect(resolve).not.toHaveBeenCalled()
  })
})

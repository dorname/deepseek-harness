/** Cached Anthropic-compatible model discovery for the DeepSeek API-key route. @module dsh-llm-deepseek-api-key/discovery */

import { createHmac, randomBytes } from 'node:crypto'
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { messagesApiRoot } from '@deepseek-ai/dsh-llm-deepseek'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedDeepSeekOptions } from './config.ts'

const ANTHROPIC_VERSION = '2023-06-01'
const DISCOVERY_TIMEOUT = 'DEEPSEEK_DISCOVERY_TIMEOUT'
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/**
 * Gateway suffixes whose prefixed path hosts Anthropic Messages but not always
 * a model listing. Longest first so the most specific suffix wins. Members and
 * order follow the cc-switch model-fetch prior art; the DeepSeek official route
 * is the motivating case (`/anthropic` prefix path answers 404, the origin root
 * serves the listing).
 */
const LISTING_COMPAT_SUFFIXES: readonly string[] = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
]

/**
 * Ordered model-listing candidate URLs for one resolved endpoint. The primary
 * candidate follows the Messages root; a gateway-suffixed path gains origin
 * root fallbacks. Derivation is deterministic: the same endpoint always tries
 * the same chain, so the cache key needs no candidate or winning URL.
 */
function listingUrls(baseURL: string): string[] {
  const urls = [`${messagesApiRoot(baseURL)}/models`]
  const parsed = new URL(baseURL)
  const pathname = parsed.pathname.replace(/\/+$/u, '')
  const suffix = LISTING_COMPAT_SUFFIXES.find(candidate => pathname.endsWith(candidate))
  if (suffix !== undefined) {
    const root = `${parsed.origin}${pathname.slice(0, -suffix.length)}`
    urls.push(`${root}/v1/models`, `${root}/models`)
  }
  return [...new Set(urls)]
}

interface CachedCatalog {
  expiresAt: number
  models: LlmModelInfo[]
}

interface SharedDiscovery {
  controller: AbortController
  promise: Promise<LlmModelInfo[]>
  settled: boolean
  waiters: number
}

function aborted(): LlmError {
  return new LlmError('DeepSeek model discovery aborted by caller', 'ABORTED')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw aborted()
}

/**
 * Await `promise`, rejecting promptly when `signal` aborts. The losing side's
 * settlement is intentionally dropped: its owner owns any transport cleanup.
 */
async function awaitDetached<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const loser = Promise.withResolvers<never>()
  const onAbort = (): void => { loser.reject(aborted()) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([promise, loser.promise])
  } catch (error: unknown) {
    if (signal.aborted) {
      void promise.catch(() => {})
      throw aborted()
    }
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function awaitCaller<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfAborted(signal)
  return signal === undefined ? promise : awaitDetached(promise, signal)
}

function detached(models: readonly LlmModelInfo[]): LlmModelInfo[] {
  return models.map(model => ({ ...model }))
}

function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

function invalidListing(url: string, detail: string): LlmError {
  return new LlmError(`${url} returned an invalid model listing: ${detail}`, 'DISCOVERY_FAILED')
}

function httpListingError(url: string, status: number): LlmError {
  return new LlmError(
    `${url} answered ${status}${status === 401 || status === 403 ? '; check the API key' : ''}`,
    'DISCOVERY_FAILED',
    { status },
  )
}

/** A candidate answered 404/405: this URL hosts no model listing, so the chain advances. */
class NoListingError extends LlmError {
  /** HTTP status that classified this candidate as listing-less; always present. */
  readonly listingStatus: 404 | 405

  constructor(url: string, status: 404 | 405) {
    super(`${url} answered ${status}`, 'DISCOVERY_FAILED', { status })
    this.listingStatus = status
  }
}

function readListing(body: unknown, provider: string, url: string): LlmModelInfo[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidListing(url, 'expected an object with a data array')
  }
  const data: unknown = Reflect.get(body, 'data')
  if (!Array.isArray(data)) throw invalidListing(url, 'expected an object with a data array')
  const rows: readonly unknown[] = data
  const seen = new Set<string>()
  const models: LlmModelInfo[] = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    const id = label(Reflect.get(row, 'id'))
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    models.push({
      provider,
      id,
      name: label(Reflect.get(row, 'name'), Reflect.get(row, 'display_name'), Reflect.get(row, 'displayName')) ?? id,
    })
  }
  return models
}

async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError => new LlmError(
    `${url} returned a model listing larger than ${MAX_RESPONSE_BYTES} bytes`,
    'DISCOVERY_FAILED',
  )
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch((_cleanupError: unknown) => {
      // The listing is already complete or has failed; reader cleanup cannot replace that result.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * One candidate listing request: transport, status, bound, parse, and schema.
 * Every failure is an `LlmError`; a 404/405 means this URL hosts no listing.
 */
async function fetchListing(
  provider: string,
  url: string,
  apiKey: string,
  limitSignal: AbortSignal,
): Promise<LlmModelInfo[]> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': apiKey,
        ...attributionHeaders(),
      },
      redirect: 'error',
      signal: limitSignal,
    })
    if (!response.ok) throw response.status === 404 || response.status === 405
      ? new NoListingError(url, response.status)
      : httpListingError(url, response.status)
    const text = await readBounded(response, url)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch (_parseError: unknown) {
      throw new LlmError(`${url} did not return a JSON model listing`, 'DISCOVERY_FAILED')
    }
    return readListing(body, provider, url)
  } catch (error: unknown) {
    if (error instanceof LlmError) throw error
    throw new LlmError(`could not reach ${url} for DeepSeek model discovery`, 'DISCOVERY_FAILED')
  }
}

async function discoverOnce(
  provider: string,
  connection: ResolvedDeepSeekOptions,
  apiKey: string,
  signal: AbortSignal,
): Promise<LlmModelInfo[]> {
  using limit = deadline(signal, connection.discoveryTimeoutMs, DISCOVERY_TIMEOUT)
  const urls = listingUrls(connection.baseURL)
  let lastStatus = 0
  for (const url of urls) {
    try {
      const models = await fetchListing(provider, url, apiKey, limit.signal)
      throwIfAborted(signal)
      return models
    } catch (error: unknown) {
      if (timeoutOf(limit.signal, DISCOVERY_TIMEOUT) !== undefined) {
        throw new LlmError(`DeepSeek model discovery timed out after ${connection.discoveryTimeoutMs}ms`, 'TIMEOUT')
      }
      if (signal.aborted) throw aborted()
      // NoListingError means "no listing endpoint here" and advances the chain;
      // every other failure belongs to a live endpoint and must surface as-is.
      if (error instanceof NoListingError) {
        lastStatus = error.listingStatus
        continue
      }
      throw error
    }
  }
  throw new LlmError(
    `no model listing endpoint at ${urls.join(', ')} (last status ${lastStatus})`,
    'DISCOVERY_FAILED',
    { status: lastStatus },
  )
}

/** Per-plugin successful-catalog cache with cancellable concurrent discovery. */
export class DeepSeekModelDiscovery {
  private readonly cached = new Map<string, CachedCatalog>()
  private readonly inflight = new Map<string, SharedDiscovery>()
  private readonly credentialSalt = randomBytes(32)
  private disposed = false
  private disposal: Promise<void> | undefined

  private isDisposed(): boolean { return this.disposed }

  /**
   * Return one current provider catalog from cache or the configured endpoint.
   * @param provider - provider route owning the catalog.
   * @param connection - endpoint and discovery settings from one configuration generation.
   * @param resolveApiKey - current credentials-first API-key resolver.
   * @param signal - cancellation for this caller; other concurrent callers remain independent.
   * @returns detached endpoint models in upstream order.
   */
  async discover(
    provider: string,
    connection: ResolvedDeepSeekOptions,
    resolveApiKey: (connection: ResolvedDeepSeekOptions) => Promise<string>,
    signal?: AbortSignal,
  ): Promise<LlmModelInfo[]> {
    throwIfAborted(signal)
    if (this.disposed) throw aborted()
    const apiKey = await awaitCaller(resolveApiKey(connection), signal)
    throwIfAborted(signal)
    // Re-read through a method: dispose can happen while awaiting the
    // credential, and a field read keeps the earlier narrowing.
    if (this.isDisposed()) throw aborted()
    const fingerprint = createHmac('sha256', this.credentialSalt).update(apiKey).digest('base64url')
    const key = JSON.stringify([
      'anthropic-messages',
      provider,
      connection.baseURL,
      connection.apiKeyEnv,
      connection.discoveryTimeoutMs,
      connection.discoveryCacheTtlMs,
      fingerprint,
    ])
    const now = Date.now()
    for (const [cachedKey, entry] of this.cached) {
      if (entry.expiresAt <= now) this.cached.delete(cachedKey)
    }
    const cached = this.cached.get(key)
    if (cached !== undefined) return detached(cached.models)
    // An unsettled operation stays in `inflight` until its settlement cleanup:
    // the last-waiter release is the only path that removes it early, and
    // disposal rejects re-entry, so a lookup never observes an aborted entry.
    let operation = this.inflight.get(key)
    if (operation === undefined) {
      const controller = new AbortController()
      const run = async (): Promise<LlmModelInfo[]> => {
        // A transport that lost its owner to abort or disposal is rejected by
        // `discoverOnce`'s own terminal abort check before anything caches.
        const models = await discoverOnce(provider, connection, apiKey, controller.signal)
        if (connection.discoveryCacheTtlMs > 0) {
          this.cached.set(key, {
            expiresAt: Date.now() + connection.discoveryCacheTtlMs,
            models: detached(models),
          })
        }
        return models
      }
      const promise = run()
      const shared: SharedDiscovery = { controller, promise, settled: false, waiters: 0 }
      operation = shared
      this.inflight.set(key, shared)
      const cleanup = (): void => {
        shared.settled = true
        if (this.inflight.get(key) === shared) this.inflight.delete(key)
      }
      void promise.then(cleanup, cleanup)
    }
    try {
      const models = await this.wait(key, operation, signal)
      return detached(models)
    } catch (error: unknown) {
      if (operation.waiters === 0 && !operation.settled) {
        this.inflight.delete(key)
        operation.controller.abort()
      }
      throw error
    }
  }

  private async wait(key: string, operation: SharedDiscovery, signal: AbortSignal | undefined): Promise<LlmModelInfo[]> {
    throwIfAborted(signal)
    operation.waiters += 1
    // One release per waiter by construction: the abort listener releases with
    // cancelled=true, the settlement paths release with cancelled=false, and
    // their overlap resolves through the signal.aborted check below.
    const release = (cancelled: boolean): void => {
      operation.waiters -= 1
      if (cancelled && operation.waiters === 0 && !operation.settled) {
        this.inflight.delete(key)
        operation.controller.abort()
      }
    }
    if (signal === undefined) return operation.promise.finally(() => { release(false) })
    const onAbort = (): void => { release(true) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const models = await awaitDetached(operation.promise, signal)
      release(false)
      return models
    } catch (error: unknown) {
      // A caller abort already released with cancelled=true in onAbort.
      if (!signal.aborted) release(false)
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** Stop outstanding requests and release cached state after they settle. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.cached.clear()
    const pending = [...this.inflight.values()]
    for (const operation of pending) operation.controller.abort()
    this.disposal = Promise.allSettled(pending.map(operation => operation.promise)).then(() => undefined)
    return this.disposal
  }
}

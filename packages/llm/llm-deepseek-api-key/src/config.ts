/** API-key configuration resolved together with one Messages endpoint generation. */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { deepSeekConfigFields, deepSeekModelsSchema, type Config as ProtocolConfig, plainOptions as protocolOptions, resolveAdapterOptions as resolveProtocolOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { Options as ProtocolOptions, DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000
const DEFAULT_DISCOVERY_CACHE_TTL_MS = 30_000

/** Messages configuration with endpoint discovery and a per-request API-key reference. */
export interface Config extends ProtocolConfig {
  /** Credential reference resolved per request; defaults to DEEPSEEK_API_KEY. */
  apiKeyEnv: Volatile<string>
  /** Maximum duration of one model-list request (default 10 seconds). */
  discoveryTimeoutMs: Volatile<number>
  /** Lifetime of a successful model-list result (default 30 seconds); zero disables result reuse. */
  discoveryCacheTtlMs: Volatile<number>
}
export const Config = z.object({
  ...deepSeekConfigFields,
  models: deepSeekModelsSchema.extra('default', undefined).volatile(),
  apiKeyEnv: z.string().role('credential-ref').default('DEEPSEEK_API_KEY').volatile(),
  discoveryTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISCOVERY_TIMEOUT_MS).volatile(),
  discoveryCacheTtlMs: z.number().min(0).max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISCOVERY_CACHE_TTL_MS).volatile(),
})
/** Plain deployment inputs for the API-key provider. */
export type Options = ProtocolOptions & {
  apiKeyEnv?: string
  discoveryTimeoutMs?: number
  discoveryCacheTtlMs?: number
}
/** Endpoint, catalog policy, and credential reference captured from the same configuration generation. */
export interface ResolvedDeepSeekOptions extends DeepSeekConnectionOptions {
  /** Credential reference used only for this connection snapshot. */
  apiKeyEnv: CredentialRef
  /** Whether the advertised catalog comes from the endpoint or an explicit models override. */
  modelsSource: 'endpoint' | 'config'
  /** Maximum duration of one endpoint discovery operation. */
  discoveryTimeoutMs: number
  /** Lifetime of a successful endpoint discovery result; zero disables result reuse. */
  discoveryCacheTtlMs: number
}
/** Read one validated provider configuration.
 * @param config - live plugin configuration.
 * @returns detached resolver inputs.
 */
export function plainOptions(config: Config): Options {
  return {
    ...protocolOptions(config),
    apiKeyEnv: config.apiKeyEnv.get(),
    discoveryTimeoutMs: config.discoveryTimeoutMs.get(),
    discoveryCacheTtlMs: config.discoveryCacheTtlMs.get(),
  }
}
/** Resolve API-key, discovery, and protocol settings together.
 * @param config - raw deployment settings.
 * @param environment - application launch environment.
 * @returns validated endpoint facts and the matching catalog and credential policy.
 */
export function resolveAdapterOptions(config: Options, environment?: LaunchEnvironmentSnapshot): ResolvedDeepSeekOptions {
  const discoveryTimeoutMs = config.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS
  if (!Number.isFinite(discoveryTimeoutMs) || discoveryTimeoutMs <= 0 || discoveryTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-deepseek: discoveryTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const discoveryCacheTtlMs = config.discoveryCacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS
  if (!Number.isFinite(discoveryCacheTtlMs) || discoveryCacheTtlMs < 0 || discoveryCacheTtlMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-deepseek: discoveryCacheTtlMs must be a non-negative finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    ...resolveProtocolOptions(config, environment),
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? 'DEEPSEEK_API_KEY'),
    modelsSource: config.models === undefined ? 'endpoint' : 'config',
    discoveryTimeoutMs,
    discoveryCacheTtlMs,
  }
}

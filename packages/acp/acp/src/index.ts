/**
 * Automation-only Agent Client Protocol server over JSON-RPC stdio.
 *
 * The bridge exposes persistent harness sessions to trusted programmatic
 * clients. It carries standard configuration, MCP mounts, prompt content,
 * committed semantic updates, cancellation, and one-shot permission decisions;
 * presentation and human-interaction features stay with the harness's UI modules.
 *
 * @module @deepseek-ai/dsh-acp
 */

import type { Context } from '@deepseek-ai/cordis'
import { Readable, Writable } from 'node:stream'
import {
  ndJsonStream,
  type Stream,
} from '@agentclientprotocol/sdk'
import {
  AcpBridge,
  Config as BridgeConfig,
  inject as bridgeInject,
  type AcpBridgeOptions,
} from './bridge.ts'

export {
  AcpBridge,
  Config as BridgeConfig,
  inject as bridgeInject,
  type AcpBridgeOptions,
  type AcpConnection,
  type Authenticator,
} from './bridge.ts'
export { AcpModelConfigError, AcpModelControl } from './model-control.ts'
export {
  COMPACTION_METHOD,
  parseCompactionRequest,
  sessionCompactWireError,
  type AcpCompactionRequest,
  type AcpCompactionResponse,
  type AcpCompactionResult,
} from './compaction.ts'
export {
  applySessionMode,
  NORMAL_MODE_ID,
  parseSessionModeId,
  PLAN_MODE_ID,
  SESSION_MODE_IDS,
  sessionModes,
  type RequestPermissionOutcome,
} from './plan-mode.ts'
export { AcpPermissionConfigError, AcpPermissionControl } from './permission-control.ts'
export {
  listSessionSkills,
  parseSkillsListRequest,
  SKILLS_LIST_METHOD,
  type AcpSkillEntry,
  type AcpSkillList,
  type AcpSkillListRequest,
  type ScopedSkillSource,
} from './skill-list.ts'
export type { ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'

/** Public Config schema exposed by this plugin. */
export const Config = BridgeConfig

/** Services required by this plugin. */
export const inject = bridgeInject

/** Plugin name. */
export const name = 'acp'

/**
 * Internal runtime/test-only overrides beyond the public Config schema.
 * Tests inject an in-memory stream here; network transports use {@link AcpBridge}
 * directly. Named distinctly from `bridge.ts`'s `AcpConfig` (the schema type)
 * so one catalog paste closure can carry both.
 */
export interface AcpPluginConfig extends AcpBridgeOptions {
  /** Runtime-only transport override; production uses stdio. */
  stream?: Stream
}

/**
 * Mount the automation-only ACP server over stdio.
 * @param ctx - Cordis context carrying the agent factory and session events.
 * @param config - Initial provider/model selection and optional test transport.
 */
export function apply(ctx: Context, config: AcpPluginConfig): void {
  const bridge = new AcpBridge(ctx, config)
  /* v8 ignore next 2 -- production stdio wiring; tests inject config.stream. */
  const stream: Stream = config.stream ?? ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  )
  const connection = bridge.connect(stream)
  ctx.effect(() => () => {
    connection.close().catch((error: unknown) => {
      ctx.logger.warn(`acp: connection-close teardown failed: ${String(error)}`)
    })
  }, 'acp.connection')
}
